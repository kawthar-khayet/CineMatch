# Crée l'hébergement du site web de CineMatch sur Azure : plan App Service (Linux, B1) + application Node.js.
# Configure l'application (base de service, secret de rafraîchissement) et écrit SITE_URL et
# SITE_REVALIDATE_SECRET dans .env, pour que la tâche Airflow publish_serving prévienne le site.
#
# Prérequis : az login, et 01-create-database.ps1 déjà exécuté (SERVING_DATABASE_URL dans .env).
# Exécution, depuis la racine du projet :  .\infra\azure\02-create-site.ps1

param(
    [string]$ResourceGroup = "cinematch-rg",
    [string]$Location = "spaincentral",
    [string]$PlanName = "cinematch-plan",
    [string]$AppName = "cinematch",          # doit être unique dans tout Azure : c'est le début de l'adresse du site
    [string]$Sku = "B1"                          # B1 : site toujours allumé (~13 $/mois). F1 : gratuit, mais le site s'endort
)

$envFile = Join-Path (Resolve-Path "$PSScriptRoot\..\..") ".env"

function Get-EnvValue([string]$name) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
    if ($line) { return $line.Substring($name.Length + 1).Trim() }
    return ""
}

function Set-EnvValue([string]$name, [string]$value) {
    $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch "^$name=" })
    $lines += "$name=$value"
    [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))
}

$databaseUrl = Get-EnvValue "SERVING_DATABASE_URL"
if (-not $databaseUrl) { throw "SERVING_DATABASE_URL absent de .env : lancer d'abord 01-create-database.ps1" }

# Secret partagé entre Airflow et le site (route /api/revalidate) : réutilisé s'il existe déjà
$secret = Get-EnvValue "SITE_REVALIDATE_SECRET"
if (-not $secret) {
    $chars = (48..57) + (65..90) + (97..122) | ForEach-Object { [char]$_ }
    $secret = -join (1..40 | ForEach-Object { $chars | Get-Random })
}

Write-Host "1/5  Activation du service App Service sur l'abonnement (1 à 2 minutes la première fois)..."
az provider register --namespace Microsoft.Web --wait
if ($LASTEXITCODE -ne 0) { throw "Activation du service App Service impossible" }

Write-Host "2/5  Plan App Service $PlanName (Linux, niveau $Sku)..."
az appservice plan create --resource-group $ResourceGroup --name $PlanName --location $Location --is-linux --sku $Sku --output none
if ($LASTEXITCODE -ne 0) { throw "Création du plan impossible : lire le message d'Azure ci-dessus" }

Write-Host "3/5  Application web $AppName (Node.js 24 LTS)..."
az webapp show --resource-group $ResourceGroup --name $AppName --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    az webapp create --resource-group $ResourceGroup --plan $PlanName --name $AppName --runtime "NODE:24-lts" --https-only true --output none
    if ($LASTEXITCODE -ne 0) { throw "Création de l'application impossible : lire le message d'Azure ci-dessus (si le nom $AppName est déjà pris, relancer avec -AppName <autre-nom>)" }
}

Write-Host "4/5  Configuration de l'application..."
# Le site est un serveur Next.js autonome : Azure le démarre avec « node server.js ».
# Always On (niveau B1 et plus) : le site reste chargé en mémoire, pas de délai au premier visiteur.
$alwaysOn = if ($Sku -eq "F1") { "false" } else { "true" }
az webapp config set --resource-group $ResourceGroup --name $AppName --startup-file "node server.js" --always-on $alwaysOn --output none
if ($LASTEXITCODE -ne 0) { throw "Configuration impossible : lire le message d'Azure ci-dessus" }

# --output none : sans cela, la commande afficherait les réglages, secrets compris
az webapp config appsettings set --resource-group $ResourceGroup --name $AppName --output none --settings `
    "DATABASE_URL=$databaseUrl" `
    "REVALIDATE_SECRET=$secret" `
    "HOSTNAME=0.0.0.0" `
    "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
if ($LASTEXITCODE -ne 0) { throw "Réglages de l'application impossibles : lire le message d'Azure ci-dessus" }

Write-Host "5/5  Écriture de SITE_URL et SITE_REVALIDATE_SECRET dans .env..."
$hostName = az webapp show --resource-group $ResourceGroup --name $AppName --query defaultHostName --output tsv
if (-not $hostName) { throw "Adresse du site introuvable" }
Set-EnvValue "SITE_URL" "https://$hostName"
Set-EnvValue "SITE_REVALIDATE_SECRET" $secret

Write-Host ""
Write-Host "Terminé. Adresse du site : https://$hostName"
Write-Host "Le site est vide tant qu'il n'est pas déployé : lancer .\infra\azure\03-deploy-site.ps1 -AppName $AppName"
