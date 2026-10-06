# publish-github.ps1
# Publishes this project to YOUR GitHub account as a public, open-source repo.
# Run it with "Publish to GitHub.bat". You log in yourself in the browser (Boba never sees your password).

# Keep going on tool warnings; we check each step's result ourselves
$ErrorActionPreference = 'Continue'
$RepoName = 'boba-minecraft-server-host'
$Description = 'Free open-source Minecraft server host for Windows: no port forwarding, permanent playit.gg address, Paper/Fabric/Forge/NeoForge, Modrinth modpacks, console, file explorer and backups.'
$Topics = 'minecraft,minecraft-server,minecraft-server-manager,minecraft-server-hosting,minecraft-server-panel,electron,nodejs,papermc,fabric,forge,neoforge,quilt,modpack,modrinth,playit,port-forwarding,self-hosted,windows,gui,desktop-app'

# Go to the project folder (one level up from /scripts)
Set-Location (Split-Path $PSScriptRoot -Parent)

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Magenta }

# Reload PATH so freshly installed tools are found
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# 1) Make sure Git and the GitHub CLI are installed
Step 'Checking for Git and GitHub CLI'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Git...'
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing GitHub CLI...'
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

# 2) Log in to GitHub (opens your browser the first time)
Step 'Logging in to GitHub'
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  gh auth login --web --git-protocol https --hostname github.com
  if ($LASTEXITCODE -ne 0) { throw 'GitHub login was cancelled.' }
}
$Owner = (gh api user --jq .login).Trim()
$UserId = (gh api user --jq .id).Trim()
Write-Host "Logged in as $Owner" -ForegroundColor Green

# 3) Put your username into README.md and package.json links
Step 'Filling in your GitHub username'
foreach ($file in @('README.md', 'package.json')) {
  $text = Get-Content $file -Raw -Encoding UTF8
  $text = $text -replace 'github\.com/OWNER/', "github.com/$Owner/" -replace 'github/stars/OWNER/', "github/stars/$Owner/"
  [IO.File]::WriteAllText((Resolve-Path $file), $text, (New-Object Text.UTF8Encoding $false))
}

# 4) Create the git repository and the first commit
Step 'Preparing the files'
if (-not (Test-Path .git)) { git init -b main | Out-Null }
if (-not (git config user.name))  { git config user.name $Owner }
if (-not (git config user.email)) { git config user.email "$UserId+$Owner@users.noreply.github.com" }
git add -A

# Safety check: NEVER upload your servers, Java, or your private playit secret
$privateFiles = git ls-files --cached -- data servers runtime tools node_modules
if ($privateFiles) { throw "Stopped: private files were about to be uploaded:`n$privateFiles" }

git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m 'Boba Minecraft Server Host Tool v1.0.0' | Out-Null }
git branch -M main

# 5) Create the public repo on GitHub and upload
Step "Creating github.com/$Owner/$RepoName"
gh repo view "$Owner/$RepoName" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  gh repo create $RepoName --public --description $Description --source . --remote origin --push
} else {
  Write-Host 'Repo already exists, uploading changes...'
  if (-not (git remote)) { git remote add origin "https://github.com/$Owner/$RepoName.git" }
  git push -u origin main
}

# 6) Topics (help people find it in GitHub search) + homepage
Step 'Adding search topics'
gh repo edit "$Owner/$RepoName" --add-topic $Topics --homepage "https://github.com/$Owner/$RepoName#readme" --enable-issues --enable-discussions | Out-Null

# 7) A first release (shows up nicely on the repo page and in search)
Step 'Creating release v1.0.0'
gh release view v1.0.0 --repo "$Owner/$RepoName" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  $notes = "First public release of Boba Minecraft Server Host Tool.`n`n- Host Vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge and Modrinth modpacks`n- No port forwarding with a permanent playit.gg address`n- Built-in console, file explorer, players, mods/plugins browser and backups`n`n**Install:** download the source zip below, install Node.js LTS, then double-click Start Boba.bat."
  gh release create v1.0.0 --repo "$Owner/$RepoName" --title 'Boba v1.0.0' --notes $notes | Out-Null
}

Step 'Done!'
Write-Host "Your project is live: https://github.com/$Owner/$RepoName" -ForegroundColor Green
Write-Host ''
Write-Host 'Last step (GitHub has no command for it): repo Settings > General > Social preview > Upload docs\banner.png' -ForegroundColor Yellow
gh repo view "$Owner/$RepoName" --web
