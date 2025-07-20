#!/usr/bin/env node

/**
 * Simple test script to verify Ollama embeddings API is working
 * Run this to test the nomic-embed-text model before using it in the Personal Data server
 */

const axios = require('axios');

async function testOllamaEmbeddings() {
  const ollamaUrl = 'http://localhost:11434';
  const model = 'nomic-embed-text';
  const testText = 'This is a test string for generating embeddings';

  console.log('🧪 Testing Ollama embeddings API...');
  console.log(`URL: ${ollamaUrl}/api/embeddings`);
  console.log(`Model: ${model}`);
  console.log(`Text: "${testText}"`);
  console.log('');

  try {
    console.log('⏳ Calling Ollama API...');
    const startTime = Date.now();
    
    const response = await axios.post(
      `${ollamaUrl}/api/embeddings`,
      {
        model: model,
        prompt: testText
      },
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('✅ Success!');
    console.log(`⏱️  Response time: ${duration}ms`);
    
    if (response.data && response.data.embedding) {
      const embedding = response.data.embedding;
      console.log(`📊 Embedding dimensions: ${embedding.length}`);
      console.log(`🔢 First 5 values: [${embedding.slice(0, 5).map(x => x.toFixed(4)).join(', ')}...]`);
      
      if (embedding.length === 768) {
        console.log('✅ Correct dimensions for nomic-embed-text (768)');
      } else {
        console.log(`❌ Unexpected dimensions. Expected 768, got ${embedding.length}`);
      }
    } else {
      console.log('❌ Invalid response format');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    }

  } catch (error) {
    console.log('❌ Error calling Ollama API:');
    
    if (error.code === 'ECONNREFUSED') {
      console.log('🚫 Connection refused. Is Ollama running on localhost:11434?');
      console.log('   Try: ollama serve');
    } else if (error.response) {
      console.log(`📡 HTTP ${error.response.status}: ${error.response.statusText}`);
      console.log('Response:', error.response.data);
    } else {
      console.log('Error details:', error.message);
    }
  }
}

// Run the test
testOllamaEmbeddings().then(() => {
  console.log('');
  console.log('🏁 Test completed');
}).catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});