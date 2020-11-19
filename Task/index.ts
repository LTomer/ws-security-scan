import * as taskLib from 'azure-pipelines-task-lib/task';
import * as path from 'path';
import util = require("./util.js");
import api = require("./ws-api.js");
import simpleGit, { SimpleGit } from 'simple-git';
import { DownloadAgent } from './agent';
import { v4 as uuidv4 } from 'uuid';

const VAR_SERVICE_NAME = 'WSService';
const VAR_PRODUCT_NAME = 'ProductName';
const VAR_PROJECT_NAME = 'ProjectName';
const VAR_FOLDER = 'Folder';
const VAR_DELETE_PROJECT_DAYS = 'DeleteProjectAfterDays'
const VAR_SCAN_EXPIRED_DAYS = 'ScanExpired'
const SOURCE_CONTROL_GIT = 'TfsGit';
const SOURCE_CONTROL_GIT_MASTER = 'master';

async function run() {
    taskLib.setResourcePath(path.join(__dirname, 'task.json'));

    var input_serviceDetails = taskLib.getInput(VAR_SERVICE_NAME, true);
    if(!input_serviceDetails){
        taskLib.error(taskLib.loc("missingService"))
        return
    }

    let endpointAuthorization = taskLib.getEndpointAuthorization(input_serviceDetails, true);

    if(!endpointAuthorization){
        taskLib.error(taskLib.loc("missingServiceDetailes"))
        return
    }
    
    //Download Agent
    const agentUrl: string = endpointAuthorization.parameters['AgentUrl'] || "https://s3.amazonaws.com/unified-agent.whitesourcesoftware.com/ua/latest/wss-unified-agent.jar";
    const downloadAgentDays: number = parseInt(endpointAuthorization.parameters['DownloadAgentDays'] || '') || 7;
    
    //WS API
    const deleteProjectDays: number = parseInt(taskLib.getInput(VAR_DELETE_PROJECT_DAYS) || '') || 7;
    const apiBaseURL: string = endpointAuthorization.parameters['APIBaseURL'] || 'https://saas.whitesourcesoftware.com/api/v1.3'
    const apiKey: string = endpointAuthorization.parameters['APIKey'] || '';
    const userKey: string = endpointAuthorization.parameters['UserKey'] || '';

    //Project Details
    const productName: string = taskLib.getInput(VAR_PRODUCT_NAME, true) || '';
    const projectName: string = taskLib.getInput(VAR_PROJECT_NAME, true) || '';
    const sourceControlType: string = taskLib.getVariable('BUILD_REPOSITORY_PROVIDER') || 'UNKNOWN'
    const gitBranchName: string = taskLib.getVariable('BUILD_SOURCEBRANCHNAME') || ''

    //Scanner
    const scanFolder: string = taskLib.getInput(VAR_FOLDER, true) || '';
    const config: string = endpointAuthorization.parameters['ConfigAgent'] || '';
    const configFile: string = path.join(taskLib.getVariable('agent.tempDirectory') || '', `wss-unified-agent-${uuidv4()}.config`);
    const packagesFilePattern: string =  endpointAuthorization.parameters['PackagesFilePattern'] || '';
    //"(\.csproj$|(^packages|\/packages)\.config$)" 
    const scanExpired: number = parseInt(taskLib.getInput(VAR_SCAN_EXPIRED_DAYS) || '') || 30;

    //write config details to file, exit if somethings go wrong
    if(!util.writeToFile(configFile, config)){
        taskLib.error(taskLib.loc("missingConfig"))
        return
    }

    //Check if scan requierd
    let isScan: boolean = true
    let masterProjectName: string = GetWSProject(sourceControlType, SOURCE_CONTROL_GIT_MASTER, projectName)
    isScan = await isRunScan(apiBaseURL, apiKey, userKey, productName, masterProjectName, isScan, sourceControlType, gitBranchName, packagesFilePattern, scanExpired);

    if(isScan){
        const agentFullName = await DownloadAgent(agentUrl, downloadAgentDays);
        if(!agentFullName){
            taskLib.error(taskLib.loc("missingAgent"))
            return
        }

        let currentProjectName: string = GetWSProject(sourceControlType, gitBranchName, projectName)
        Scan(agentFullName, scanFolder, apiKey, configFile, productName, currentProjectName);

        //Delete old project relevant for GIR repository when its run on master branch.
        if(deleteProjectDays > 0 && sourceControlType == SOURCE_CONTROL_GIT && gitBranchName == SOURCE_CONTROL_GIT_MASTER){
            DeleteProject(apiBaseURL, apiKey, userKey, productName, masterProjectName, deleteProjectDays)
        }
    }
    else{
        console.log('- Scan for vulnerability is not necessary')
    }
}

async function DeleteProject(apiBaseUrl: string, apiKey: string, userKey: string, product: string, project: string, days: number) {
    if(!userKey){
        console.log("Set UserKey for delete an old projects")
        return
    }
    let productToken = await api.getProductToken(apiBaseUrl, apiKey, userKey, product)
    
    let projectName = `${project}(`;
    await api.deleteProjectScanedBeforeDays(apiBaseUrl, userKey, productToken, days, projectName)
}

function GetWSProject(sourcecontrol_type: string, gitBranchName: string, project: string) {
    if(sourcecontrol_type != SOURCE_CONTROL_GIT)
        return project;
    if(gitBranchName == SOURCE_CONTROL_GIT_MASTER)
        return project;
    
    return `${project}(${gitBranchName})`;
}

async function isRunScan(apiBaseURL: string, apiKey: string, userKey: string, productName: string, masterProjectName: string, isScan: boolean, sourceControlType: string, gitBranchName: string, packagesFilePattern: string, scanExpired: number) {
    if(sourceControlType != SOURCE_CONTROL_GIT){
        console.log(taskLib.loc("ScanReasonNotGit"))
        return true
    }
    
    if(gitBranchName == SOURCE_CONTROL_GIT_MASTER){
        console.log(taskLib.loc("ScanReasonMaster"))
        return true
    }
    
    let packageListChanged = await GitDiffWith(SOURCE_CONTROL_GIT_MASTER, packagesFilePattern)
    if(packageListChanged){
        return true
    }
    
    let productToken: string = await api.getProductToken(apiBaseURL, apiKey, userKey, productName);
    if (typeof productToken == undefined){
        console.log(taskLib.loc("ScanReasonNoProduct"))
        return true
    }
    
    let projectTokenMaster: string = await api.getProjectToken(apiBaseURL, userKey, productToken, masterProjectName);
    if (typeof productToken == undefined){
        console.log(taskLib.loc("ScanReasonNoProject"))
        return true
    }
    
    let resVulnerabilityReport = await api.getProjectVulnerabilityReport(apiBaseURL, userKey, projectTokenMaster)
    let objVulnerabilityReport = JSON.parse(resVulnerabilityReport)
    let lastScanOnMasterFailed = objVulnerabilityReport.vulnerabilities.length > 0
    if(lastScanOnMasterFailed){
        console.log(taskLib.loc("ScanReasonNotVulnerability"))
        return true
    }
    
    let resProjectVitals = await api.getProjectVitals(apiBaseURL, userKey, projectTokenMaster)
    let objProjectVitals = JSON.parse(resProjectVitals)
    let lastUpdate = objProjectVitals.projectVitals[0]['lastUpdatedDate']
    let daysSince = util.daysSince(lastUpdate)
    if(daysSince > scanExpired || daysSince < 0){
        console.log(taskLib.loc("ScanReasonExpiredScan"))
        return true
    }

    return false
}

//return false if it equal other return true (not equal, error, git not installed)
async function GitDiffWith(branchNme: string, filePattern: string) {
    if (typeof filePattern == undefined || filePattern == null || filePattern.trim() == ""){
        console.log(taskLib.loc("ScanReasonPatternMissing"))
        return true
    }

    var commandExistsSync = require('command-exists').sync;
    let isGitExist = commandExistsSync('git')
    if(!isGitExist){
        console.log(taskLib.loc("ScanReasonGitMissing"))
        return true
    }

    const gitSourceDirectory: string = taskLib.getVariable('BUILD_SOURCESDIRECTORY') || ''
    if(!gitSourceDirectory){
        console.log(taskLib.loc("ScanReasonDirectoryMissing"))
        return true
    }

    const git: SimpleGit = simpleGit(gitSourceDirectory);
    try {
        let initResult = await git.raw(["diff", "--name-only", branchNme])
        let val = initResult.replace('\\','/').trim()

        var re = new RegExp(filePattern, "mi");//multilines, insensitive 
        var m = re.exec(val);
        if (m){
            console.log(taskLib.loc("ScanReasonDiff"))
            return true
        }
    }
    catch (e) { 
        console.log(e)
        console.log(taskLib.loc("ScanReasonDiffFailed"))
        return true
    }

    try {
        let initResult = await git.raw(["ls-tree", "-r", "--name-only", branchNme])
        let val = initResult.replace('\\','/').trim()

        var re = new RegExp(filePattern, "mi");//multilines, insensitive 
        var m = re.exec(val);
        if (m){
            console.log(taskLib.loc("ScanReasonPatternNotValid"))
            return true
        }
    }
    catch (e) { 
        console.log(e)
        console.log(taskLib.loc("ScanReasonDiffFailed"))
        return true
    }
    return false
}

function Scan(agentFullName: string, scanFolder: string, apiKey: string, configFile: string, productName: string, wsProjectName: string) {
    try {
        console.log("====== RUN WS AGENT ======")
        
        let res = taskLib.execSync('java', `-jar ${agentFullName} -d ${scanFolder} -apiKey ${apiKey} -c ${configFile} productName ${productName} projectName ${wsProjectName}`);
    
        if(res.code != 0){
            console.log('Code: ' + res.code);
            console.log('error: ' + res.error);
    
            taskLib.error("Failed to run WhiteSource Agent.")
            taskLib.command( 'task.complete', { 'result': taskLib.TaskResult.Failed }, 'Failed to run WhiteSource Agent.')
            return;
        }
    }
    catch (err) {
        taskLib.setResult(taskLib.TaskResult.Failed, err.message);
    }
}

run();