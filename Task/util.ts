import * as taskLib from 'azure-pipelines-task-lib/task';
import fs = require('fs');
import path = require('path');
import tl = require('azure-pipelines-task-lib/task');
import url_util = require('url');


export function readFromFile(filename: string){
    if (!tl.stats(filename).isFile()) 
        throw new Error(tl.loc('invalidFilePath', filename));

    let array = fs.readFileSync(filename, 'utf8').toString().split('\n');
    return array
}

export function writeToFile(filename: string, value: string) {
    try{
        let buffer = Buffer.from(value)
        fs.writeFileSync(filename, buffer)
        taskLib.debug(taskLib.loc("saveConfigFile"))
        return true
    }
    catch(error){
        taskLib.error(error);
        taskLib.setResult(taskLib.TaskResult.Failed, taskLib.loc("writeToFileFailed"));
        return false
    }
}
