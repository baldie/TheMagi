# This script handles the download and setup of the OpenVoice TTS models.
# It is designed to be called from the install-magi.bat script.

$ErrorActionPreference = "Stop" # Exit script on first error

$ModelsDir = "checkpoints_v2"
$ZipFile = "checkpoints_v2.zip"
$DownloadUrl = "https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"

Write-Host "--- Starting OpenVoice Model Setup ---"

# Check if models already exist
if (Test-Path -Path $ModelsDir) {
    Write-Host "[INFO] Models directory '$ModelsDir' already exists. Skipping download."
    Write-Host "--- Model Setup Complete ---"
    exit 0 # Success
}

Write-Host "[INFO] Models directory not found."

try {
    # Download the models
    Write-Host "[INFO] Downloading models from $DownloadUrl..."
    Write-Host "[INFO] This is a large file and may take some time."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipFile -UseBasicParsing
    Write-Host "[SUCCESS] Download complete."

    # Extract the models
    Write-Host "[INFO] Extracting models from $ZipFile..."
    Expand-Archive -Path $ZipFile -DestinationPath "." -Force
    Write-Host "[SUCCESS] Extraction complete."

    # Clean up
    Write-Host "[INFO] Removing temporary zip file..."
    Remove-Item -Path $ZipFile
    Write-Host "[SUCCESS] Cleanup complete."

    Write-Host "--- Model Setup Complete ---"

} catch {
    Write-Error "[FATAL] An error occurred during model setup."
    Write-Error "Details: $($_.Exception.Message)"
    # Exit with a non-zero status code to indicate failure
    exit 1
}

exit 0 # Success 