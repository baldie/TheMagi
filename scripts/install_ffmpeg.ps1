# This script downloads and installs ffmpeg
# Set the destination directory
$destDir = "C:\ffmpeg"

# Create the destination directory if it doesn't exist
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir
}

# Download ffmpeg
$ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$zipFile = "$destDir\ffmpeg.zip"
Invoke-WebRequest -Uri $ffmpegUrl -OutFile $zipFile

# Unzip ffmpeg
Expand-Archive -Path $zipFile -DestinationPath $destDir -Force

# Find the bin directory
$binDir = (Get-ChildItem -Path $destDir -Directory -Recurse | Where-Object { $_.Name -eq 'bin' }).FullName

# Add ffmpeg to the system PATH
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "Machine")
    Write-Host "ffmpeg has been added to the system PATH. Please restart your terminal for the changes to take effect."
} else {
    Write-Host "ffmpeg is already in the system PATH."
}

# Clean up the zip file
Remove-Item -Path $zipFile 