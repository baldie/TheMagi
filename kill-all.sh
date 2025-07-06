echo "stopping TTS"
pkill -f tts_server.py
echo "stopping orchestrator"
pkill -f orchestrator
echo "stopping conduit"
pkill -f ollama

# Replace 'PORT_NUMBER' with the actual port number you want to target.
PORT_NUMBER=4200

# Find the PID of the process listening on the specified port
PID=$(lsof -t -i :$PORT_NUMBER)

# Check if a PID was found
if [ -z "$PID" ]; then
  echo "UI server already stopped"
else
  echo "stopping UI server"
  kill -9 $PID
fi