# Construit le site web et le déploie sur Azure App Service, depuis le PC.
# (Le workflow .github/workflows/deploy-site.yml fait la même chose automatiquement à chaque push sur main.)
#
# Le site est construit dans un conteneur Linux (image node:24), comme sur Azure : un build fait sous Windows
# embarque des composants Windows (ex. sharp-win32) qui ne fonctionnent pas sur les serveurs Linux d'Azure.
#
# Prérequis : Docker démarré, az login, 01 et 02 déjà exécutés.
# Exécution, depuis la racine du projet :  .\infra\azure\03-deploy-site.ps1
# Pour seulement construire le paquet, sans déployer :  .\infra\azure\03-deploy-site.ps1 -BuildOnly

param(
    [string]$ResourceGroup = "cinematch-rg",
    [string]$AppName = "cinematch",
    [switch]$BuildOnly
)

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$envFile = Join-Path $root ".env"
$frontend = Join-Path $root "frontend"
$outDir = Join-Path $root "infra\azure\.build"
$package = Join-Path $outDir "site.zip"

$line = Get-Content $envFile | Where-Object { $_ -match "^SERVING_DATABASE_URL=" } | Select-Object -Last 1
if (-not $line) { throw "SERVING_DATABASE_URL absent de .env : lancer d'abord 01-create-database.ps1" }

New-Item -ItemType Directory -Force $outDir | Out-Null
if (Test-Path $package) { Remove-Item $package -Force -Confirm:$false }

Write-Host "1/2  Construction du site dans un conteneur Linux (3 à 6 minutes la première fois)..."
# La base de service est lue pendant le build, pour pré-générer les pages.
# Son adresse est passée par une variable d'environnement : elle n'apparaît pas dans la commande.
$env:DATABASE_URL = $line.Substring("SERVING_DATABASE_URL=".Length).Trim()
$build = @'
set -e
mkdir /build
tar -C /src --exclude=node_modules --exclude=.next --exclude=.env.local -cf - . | tar -C /build -xf -
cd /build
npm ci --no-audit --no-fund
npm run build
cp -r .next/static .next/standalone/.next/static
if [ -d public ]; then cp -r public .next/standalone/public; fi
cd .next/standalone
python3 -m zipfile -c /out/site.zip .
'@ -replace "`r", ""
# (Pas de guillemets doubles dans ce script : Windows PowerShell les supprime en le passant à Docker.)
docker run --rm -e DATABASE_URL -e BUILD_STANDALONE=1 -e NEXT_TELEMETRY_DISABLED=1 `
    -v "${frontend}:/src:ro" -v "${outDir}:/out" node:24 bash -c $build
$env:DATABASE_URL = $null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $package)) { throw "Construction du site impossible : lire les messages ci-dessus" }
Write-Host ("     Paquet prêt : {0:N0} Mo" -f ((Get-Item $package).Length / 1MB))

if ($BuildOnly) { Write-Host "Construction seule demandée : pas de déploiement."; return }

Write-Host "2/2  Déploiement sur $AppName (1 à 3 minutes)..."
# --track-status false : on ne se fie pas au suivi de démarrage d'Azure, qui peut annoncer un échec alors que le site
# démarre (au premier déploiement, il tente de lancer le site avant l'arrivée des fichiers). On vérifie nous-mêmes.
az webapp deploy --resource-group $ResourceGroup --name $AppName --src-path $package --type zip --track-status false --output none
if ($LASTEXITCODE -ne 0) { throw "Envoi du paquet impossible : lire le message d'Azure ci-dessus" }

$hostName = az webapp show --resource-group $ResourceGroup --name $AppName --query defaultHostName --output tsv
Write-Host "     Paquet envoyé. Attente du démarrage du site (jusqu'à 5 minutes)..."
$online = $false
foreach ($attempt in 1..30) {
    try {
        $response = Invoke-WebRequest -Uri "https://$hostName/" -UseBasicParsing -TimeoutSec 60
        if ($response.StatusCode -eq 200) { $online = $true; break }
    } catch { }
    Start-Sleep -Seconds 10
}
if (-not $online) { throw "Le site ne répond pas : voir les journaux avec  az webapp log tail --resource-group $ResourceGroup --name $AppName" }

Write-Host ""
Write-Host "Terminé. Le site est en ligne : https://$hostName"
