# vlocity -sfdx.username "rocco.sorrentino@amplifonapac.com.prtuat01" -job "./jobs/DeployPRTUATforBS.yaml" packDeploy

# vlocity -sfdx.username "rocco.sorrentino@amplifonapac.com.mastcatdev" -job "./jobs/ExportForBS.yaml" packExport
# vlocity -sfdx.username "rocco.sorrentino@amplifonapac.com.prtuat01" -job "./jobs/BackupUAT.yaml" packExport

vlocity -sfdx.username "rocco.sorrentino@amplifonapac.com.prtuat01" -job "./jobs/DeployPRTUATforBS.yaml" packDeploy

vlocity -sfdx.username "rocco.sorrentino@amplifonapac.com.prtuat01" -job "./jobs/DeployPRTUATforBS.yaml" packRetry