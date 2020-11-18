//import unirest = require('unirest');
//import * as taskLib from 'azure-pipelines-task-lib/task';
import fs = require('fs');
//import { stringify } from 'querystring';

function apiRequest(url: string, body: any): Promise<string> {
    return new Promise((resolve, reject) => {
        var unirest = require('unirest');
        var req = unirest('POST', url)
        .headers({
            'Content-Type': 'application/json'
        })
        .send(JSON.stringify(body))
        .end(function (res: any) { 
            if (res.error) 
                reject(new Error(res.error)); 
            if(!res.body)
                reject(new Error(`taskLib.loc('dataOnPathNotExist')`)); 

            resolve(JSON.stringify(res.body));
        });
    })
}

export async function getProductToken(url: string, orgToken: string, userKey: string, productName: string) {
    let body = {
        "requestType" : "getAllProducts",
        "userKey": userKey,
        "orgToken" : orgToken
    };
        
    let res = await apiRequest(url, body);
    let obj = JSON.parse(res)

    for(var i = 0; i < obj.products.length; ++i){
        if(obj.products[i].productName == productName || obj.products[i].productToken == productName){
            return obj.products[i].productToken
        }
    }

    return undefined
}

export async function getAllProjects(url: string, productToken: string, userKey: string) {
    let body = {
        "requestType" : "getAllProjects",
        "userKey": userKey,
        "productToken" : productToken
    }
        
    return await apiRequest(url, body);
}

export async function getProjectInventory(url: string, userKey: string, projectToken: string) {
    let body = {
        "requestType" : "getProjectInventory",
        "userKey": userKey,
        "projectToken" : projectToken,
        "includeInHouseData" : false
    }
        
    return await apiRequest(url, body);
}

export async function getProjectVulnerabilityReport(url: string, userKey: string, projectToken: string) {
    let body = {
        "requestType" : "getProjectVulnerabilityReport",
        "userKey": userKey,
        "projectToken" : projectToken,
        "format" : "json"
    }

    return await apiRequest(url, body);
}

export async function getProjectVitals(url: string, userKey: string, projectToken: string) {
    let body = {
        "requestType" : "getProjectVitals",
        "userKey": userKey,
        "projectToken" : projectToken
    }

    return await apiRequest(url, body);
}

export async function deleteProject(url: string, userKey: string, productToken: string, projectToken: string) {
    let body = {
        "requestType" : "deleteProject",
        "userKey": userKey,
        "productToken" : productToken,
        "projectToken": projectToken
    }

    return await apiRequest(url, body);
}

export async function getProjectToken(url: string, userKey: string, productToken: string, projectName: string) {
    let res = await getAllProjects(url, productToken, userKey)
    let obj = JSON.parse(res)

    for(var i = 0; i < obj.projects.length; ++i){
        if(obj.projects[i].projectName == projectName || obj.projects[i].projectToken == projectName){
            return obj.projects[i].projectToken
        }
    }

    return undefined
}

export async function deleteProjectScanedBeforeDays(url: string, userKey: string, productToken: string, days: number, projectName?: string) {
    const today = new Date();
    
    let res = await getAllProjects(url, productToken, userKey)
    let projects = JSON.parse(res).projects

    for(var i = 0; i < projects.length; ++i){
        let name: string = projects[i].projectName

        if(projectName && !name.startsWith(projectName, 0))
            continue

        let projectToken = projects[i].projectToken
            
        let res = await getProjectInventory(url, userKey, projectToken)
        let project = JSON.parse(res)

        var dateString = project.projectVitals.lastUpdatedDate;  
        let lastUpdatedDate = new Date(dateString)

        var diff = Math.abs(today.getTime() - lastUpdatedDate.getTime());
        var diffDays = Math.ceil(diff / (1000 * 3600 * 24));
        
        if(diffDays > days){
            let resDel = await deleteProject(url, userKey, productToken, projectToken)
       }
    }
}
