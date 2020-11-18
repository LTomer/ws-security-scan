import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';
import * as path from 'path';
import * as fs from 'fs';
const { v4: uuidv4 } = require('uuid');

export const TOOL_NAME: string = 'WSAgent'
export const AGENT_FILE_NAME = 'wss-unified-agent.jar';

export async function DownloadAgent(agentUrl: string, days: number) {
    try {
        const version = '0.0.0'; //latest version

        //let localVersions: string[] = toolLib.findLocalToolVersions(TOOL_NAME);
        //let eVersion: string = toolLib.evaluateVersions(localVersions, version);
        //console.log("List: " + localVersions)
        //console.log("Evaluate Versions: " + eVersion)
        let toolPath: string = toolLib.findLocalTool(TOOL_NAME, version);

        let downloadAgent = idDownloadAgent(toolPath, days);
        if (downloadAgent) {

            taskLib.debug(taskLib.loc("downloadingAgent"));
            let downloadPath: string = await toolLib.downloadTool(agentUrl);

            taskLib.debug(taskLib.loc("cachingAgent"));
            toolLib.cacheFile(downloadPath, AGENT_FILE_NAME, TOOL_NAME, version);

            console.log(taskLib.loc("agentDownloaded"));
        }

        toolPath = toolLib.findLocalTool(TOOL_NAME, version);

        let agentFullName: string = path.join(toolPath, AGENT_FILE_NAME);
        return agentFullName;

    }
    catch (err) {
        taskLib.setResult(taskLib.TaskResult.Failed, err.message);
    }
}

function idDownloadAgent(agentPath: string, days: number): boolean {
    try {
        if(!agentPath)
            return true

        const now = new Date()
        let agentFileName: string = path.join(agentPath, AGENT_FILE_NAME);
        const createdDate = fs.statSync(agentFileName).mtime;
        const diffInDays : number = ~~ ((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24))

        taskLib.debug(taskLib.loc("agentDownloadInfo", createdDate, diffInDays));
        return diffInDays >= days

    } catch (error) {
        taskLib.debug(`Agent does not exist.`)
        return true;
    }
}
