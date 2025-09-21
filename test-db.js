const { createClient } = require('@supabase/supabase-js');

// Test database connection directly
async function testDatabaseConnection() {
  console.log('🔍 Testing Supabase connection...');
  
  const supabaseUrl = 'https://oscnavzuxxuirufvzemc.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY25hdnp1eHh1aXJ1ZnZ6ZW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODI1NDUzMCwiZXhwIjoyMDczODMwNTMwfQ.O5mKWLTT04V-SemqKKkd9NBOWaOTzsQr3R8yPHmO98k';
  
  console.log('📊 Using URL:', supabaseUrl);
  console.log('🔑 Using Key:', supabaseKey.substring(0, 20) + '...');
  
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  try {
    // Test 1: Simple connection test
    console.log('\n🧪 Test 1: Basic connection...');
    const { data: timeData, error: timeError } = await supabase
      .rpc('now'); // Built-in function to get current time
      
    if (timeError) {
      console.log('❌ Time test failed:', timeError.message);
    } else {
      console.log('✅ Time test successful:', timeData);
    }
    
    // Test 2: Check if users table exists
    console.log('\n🧪 Test 2: Check users table...');
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
      
    if (usersError) {
      console.log('❌ Users table test failed:', usersError.message);
      
      // Test 3: Try to create users table
      console.log('\n🧪 Test 3: Creating users table...');
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          clerk_user_id TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          tier TEXT DEFAULT 'free',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          profile_data JSONB DEFAULT '{}',
          settings JSONB DEFAULT '{}'
        );
      `;
      
      // Try to execute raw SQL (this might not work with standard Supabase client)
      console.log('📝 Attempting to create table...');
      console.log('💡 You may need to run this SQL manually in Supabase SQL Editor:');
      console.log(createTableSQL);
      
    } else {
      console.log('✅ Users table test successful:', usersData);
    }
    
    // Test 4: Test the exact same way as the backend
    console.log('\n🧪 Test 4: Backend-style test...');
    const { data: backendTest, error: backendError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
      
    if (backendError) {
      console.log('❌ Backend-style test failed:', backendError.message);
      console.log('🔧 This is the same error the backend is getting');
    } else {
      console.log('✅ Backend-style test successful!');
    }
    
  } catch (error) {
    console.error('❌ Connection test error:', error.message);
  }
}

// Run the test
testDatabaseConnection().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});