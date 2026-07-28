echo '{"id":"1","method":"health","params":{}}' | timeout 3 node --import tsx src/agent.ts 2>/tmp/agent.log
echo "STDERR:"
cat /tmp/agent.log
