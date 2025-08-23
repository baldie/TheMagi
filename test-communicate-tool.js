// Simple test script to verify communicate tool functionality
const fs = require('fs');
const path = require('path');

// Read the tool registry to verify the communicate tool is properly defined
try {
  const toolRegistryPath = path.join(__dirname, 'services', 'orchestrator', 'src', 'mcp', 'tools', 'tool-registry.ts');
  const content = fs.readFileSync(toolRegistryPath, 'utf8');
  
  // Check if communicate tool exists
  if (content.includes("'communicate': {")) {
    console.log('✅ communicate tool found in registry');
  } else {
    console.log('❌ communicate tool NOT found in registry');
    process.exit(1);
  }
  
  // Check if it has the correct parameters
  if (content.includes('message:') && content.includes('recipient:')) {
    console.log('✅ communicate tool has correct parameters (message, recipient)');
  } else {
    console.log('❌ communicate tool missing required parameters');
    process.exit(1);
  }
  
  // Check if it has the right enum values
  if (content.includes("['User', 'System', 'Magi', 'Caspar', 'Melchior', 'Balthazar']")) {
    console.log('✅ communicate tool has correct recipient enum values');
  } else {
    console.log('❌ communicate tool missing proper recipient enum');
    process.exit(1);
  }
  
  console.log('🎉 All checks passed! The communicate tool is properly configured.');
  
} catch (error) {
  console.error('❌ Error reading tool registry:', error.message);
  process.exit(1);
}