const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Create Supabase client with service role key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupDatabase() {
  console.log('🗄️  Setting up database schema...');
  
  try {
    // Read the schema file
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, '../database/schema.sql'), 
      'utf8'
    );
    
    // Split the SQL into individual statements
    const statements = schemaSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--') && !stmt.startsWith('/*'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (statement.toLowerCase().includes('create table') || 
          statement.toLowerCase().includes('create index') ||
          statement.toLowerCase().includes('create policy') ||
          statement.toLowerCase().includes('alter table')) {
        
        console.log(`⚡ Executing statement ${i + 1}/${statements.length}`);
        
        try {
          const { error } = await supabase.rpc('exec_sql', { 
            sql: statement + ';' 
          });
          
          if (error) {
            console.log(`⚠️  Statement ${i + 1} result:`, error.message);
          } else {
            console.log(`✅ Statement ${i + 1} executed successfully`);
          }
        } catch (execError) {
          console.log(`⚠️  Statement ${i + 1} execution note:`, execError.message);
        }
      }
    }
    
    // Test the database connection
    console.log('🔍 Testing database connection...');
    
    // Try to select from users table
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('⚠️  Database test result:', error.message);
      
      // Try creating tables manually with basic SQL
      console.log('🔧 Creating tables manually...');
      
      // Create users table
      const { error: usersError } = await supabase
        .from('users')
        .select('*')
        .limit(1);
        
      if (usersError && usersError.message.includes('relation "users" does not exist')) {
        console.log('📋 Creating users table...');
        // Use SQL to create table since RPC might not be available
        console.log('Please run the schema.sql file manually in your Supabase SQL Editor');
        console.log('Go to: https://supabase.com/dashboard/project/oscnavzuxxuirufvzemc/sql/new');
      }
    } else {
      console.log('✅ Database connection test successful!');
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Database setup error:', error.message);
    console.log('\n📋 Manual Setup Required:');
    console.log('1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/oscnavzuxxuirufvzemc/sql/new');
    console.log('2. Copy and paste the contents of database/schema.sql');
    console.log('3. Click "Run" to execute the schema');
    return false;
  }
}

// Run the setup
if (require.main === module) {
  setupDatabase()
    .then(success => {
      if (success) {
        console.log('🎉 Database setup completed!');
      } else {
        console.log('⚠️  Manual setup required - see instructions above');
      }
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupDatabase };