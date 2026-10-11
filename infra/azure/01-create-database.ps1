# Crée la base de service de CineMatch sur Azure : groupe de ressources + Azure Database for PostgreSQL.
# Le mot de passe est généré ici et écrit dans .env (SERVING_DATABASE_URL) : il n'est jamais affiché.
#
# Prérequis : az login (abonnement Azure for Students).
# Exécution, depuis la racine du projet :  .\infra\azure\01-create-database.ps1

param(
    [string]$ResourceGroup = "cinematch-rg",
    [string]$Location = "spaincentral",          # région autorisée par l'abonnement étudiant, la plus proche du Maroc
    [string]$ServerName = "cinematch-pg-inpt",   # doit être unique dans tout Azure
    [string]$AdminUser = "cinematchadmin",
    [string]$Database = "cinematch_serving"
)

$envFile = Join-Path (Resolve-Path "$PSScriptRoot\..\..") ".env"
if (-not (Test-Path $envFile)) { throw "Fichier .env introuvable : $envFile" }

# Mot de passe de 32 caractères, lettres et chiffres uniquement (utilisable tel quel dans une adresse de connexion)
$chars = (48..57) + (65..90) + (97..122) | ForEach-Object { [char]$_ }
$password = "Aa1" + (-join (1..29 | ForEach-Object { $chars | Get-Random }))

Write-Host "1/4  Groupe de ressources $ResourceGroup ($Location)..."
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -ne 0) { throw "Création du groupe de ressources impossible" }

# Sur un abonnement neuf, chaque service Azure doit être activé une fois (« fournisseur de ressources »)
Write-Host "     Activation du service PostgreSQL sur l'abonnement (1 à 2 minutes la première fois)..."
az provider register --namespace Microsoft.DBforPostgreSQL --wait
if ($LASTEXITCODE -ne 0) { throw "Activation du service PostgreSQL impossible" }

Write-Host "2/4  Serveur PostgreSQL $ServerName (niveau B1ms, 32 Go). Compter 5 à 10 minutes..."
# --public-access All : ouvert à toutes les adresses IP. Le site (Azure) et le pipeline (PC, adresse IP variable)
# doivent s'y connecter. La protection repose sur le mot de passe et le chiffrement TLS, obligatoire sur Azure.
# La base ne contient que des données publiques de films.
az postgres flexible-server show --resource-group $ResourceGroup --name $ServerName --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    # Script relançable : le serveur existe déjà, on lui donne seulement un nouveau mot de passe
    Write-Host "     Le serveur existe déjà : nouveau mot de passe administrateur..."
    az postgres flexible-server update --resource-group $ResourceGroup --name $ServerName --admin-password $password --output none
    if ($LASTEXITCODE -ne 0) { throw "Changement du mot de passe impossible : lire le message d'Azure ci-dessus" }
} else {
    az postgres flexible-server create `
        --resource-group $ResourceGroup --name $ServerName --location $Location `
        --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 `
        --admin-user $AdminUser --admin-password $password `
        --public-access All --yes --output none
    if ($LASTEXITCODE -ne 0) { throw "Création du serveur PostgreSQL impossible : lire le message d'Azure ci-dessus (si le nom $ServerName est déjà pris, relancer avec -ServerName <autre-nom>)" }
}

Write-Host "3/4  Base de données $Database..."
az postgres flexible-server db create --resource-group $ResourceGroup --server-name $ServerName --name $Database --output none
if ($LASTEXITCODE -ne 0) { throw "Création de la base impossible : lire le message d'Azure ci-dessus" }

Write-Host "4/4  Écriture de SERVING_DATABASE_URL dans .env..."
$url = "postgresql://${AdminUser}:${password}@${ServerName}.postgres.database.azure.com:5432/${Database}?sslmode=require"
$lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^SERVING_DATABASE_URL=' })
$lines += "SERVING_DATABASE_URL=$url"
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Terminé. Serveur : $ServerName.postgres.database.azure.com, base : $Database"
Write-Host "L'adresse de connexion est dans .env (SERVING_DATABASE_URL). Ne la partagez pas."
