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
    const packagesFilePattern: string = "(\.csproj|packages\.config)" //TODO - get value from connection service (Package file pattern)

    //write config details to file, exit if somethings go wrong
    if(!util.writeToFile(configFile, config)){
        taskLib.error(taskLib.loc("missingConfig"))
        return
    }

    //Check if scan requierd
    let masterProjectName: string = GetWSProject(sourceControlType, SOURCE_CONTROL_GIT_MASTER, projectName)
    let productToken: string = await api.getProductToken(apiBaseURL, apiKey, userKey, productName)
    let projectTokenMaster: string = await api.getProjectToken(apiBaseURL, userKey, productToken, masterProjectName)
    let isScan: boolean = await IsRunScan(sourceControlType, gitBranchName, packagesFilePattern, apiBaseURL, userKey, projectTokenMaster)
    
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

async function IsRunScan(sourcecontrol_type: string, branchNme: string, filePattern: string, url: string, userKey: string, projectToken: string) {
    if(sourcecontrol_type != SOURCE_CONTROL_GIT)
        return true
    if(branchNme == SOURCE_CONTROL_GIT_MASTER)
        return true

    let packageListChanged = await GitDiffWith(SOURCE_CONTROL_GIT_MASTER, filePattern)
    if(packageListChanged)
        return true

    let resVulnerabilityReport = await api.getProjectVulnerabilityReport(url, userKey, projectToken)
    let objVulnerabilityReport = JSON.parse(resVulnerabilityReport)
    let lastScanOnMasterFailed = objVulnerabilityReport.vulnerabilities.length > 0
    if(lastScanOnMasterFailed)
        return true

    //const scanExpired: number = 30; //TODO - get value from task (Scan Expired)
    //TODO: Check the last scan, if it bigger then 30 day run new scan
    //let resVitals = await api.getProjectVitals(url, userKey, projectToken)
    //let objVitals = JSON.parse(resVitals)
    let isScanExpired = false
    if(isScanExpired)
        return true

    return false
}

//return false if it equal other return true (not equal, error, git not installed)
async function GitDiffWith(branchNme: string, filePattern: string) {
    if (typeof filePattern != undefined || filePattern == null || filePattern != ""){
        return true
    }

    var commandExistsSync = require('command-exists').sync;
    let isGitExist = commandExistsSync('git')
    if(!isGitExist)
        return true

    const gitSourceDirectory: string = taskLib.getVariable('BUILD_SOURCESDIRECTORY') || ''
    if(!gitSourceDirectory)
        return true

    const git: SimpleGit = simpleGit(gitSourceDirectory);
    try {
        let initResult = await git.raw(["diff", "--name-only", branchNme])
        let val = initResult.replace('\\','/').replace('\n', " ; ").trim()
        val = `${val} ; `

        var re = new RegExp(filePattern,"g");
        var m = re.exec(val);
        if (m) 
            return true
    }
    catch (e) { 
        console.log(e)
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