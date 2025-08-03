import dotenv from 'dotenv';
import sql from 'mssql';
import { promises as fs } from 'fs';

// Database configuration
dotenv.config();
const dbConfig = {
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true,
    },
};
console.dir(dbConfig);

async function processKeyPair(filePath) {
    let pool;
    try {
      // Read the file
      const data = await fs.readFile(filePath, 'utf8');
      console.log('Raw file content:', JSON.stringify(data)); // Debug: Log the raw file content (stringified to show special characters)
  
      // Split the file into individual JSON objects
      // Replace newlines within objects with spaces, then split by '}\n{' to separate objects
      const cleanedData = data
        .replace(/\r?\n/g, ' ') // Replace newlines with spaces to handle multi-line objects
        .replace(/\}\s*\{/g, '}\n{'); // Ensure objects are separated by a newline
  
      console.log('Cleaned data:', cleanedData);
  
      const rawObjects = cleanedData.split('\n').filter(line => line.trim());
      console.log('Raw objects after splitting:', rawObjects);
  
      // Filter and parse objects
      const objects = rawObjects
        .map((line, index) => {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('{') || !trimmedLine.endsWith('}')) {
            console.warn(`Line ${index + 1} is not a valid JSON object: ${trimmedLine}`);
            return null;
          }
  
          try {
            const obj = JSON.parse(trimmedLine);
            if (!obj.publicKey || !obj.secretKey) {
              console.warn(`Line ${index + 1} does not contain valid publicKey and secretKey:`, obj);
              return null;
            }
            return obj;
          } catch (err) {
            console.warn(`Failed to parse line ${index + 1} as JSON: ${trimmedLine}`, err.message);
            return null;
          }
        })
        .filter(obj => obj !== null);
  
      console.log('Parsed objects:', objects);
  
      if (objects.length === 0) {
        throw new Error('No valid key pairs found in the file');
      }
  
      // Connect to database
      console.log('Connecting to database with config:', {
        user: dbConfig.user,
        server: dbConfig.server,
        database: dbConfig.database,
      });
      pool = await sql.connect(dbConfig);
      console.log('Connected to database successfully');

      // Process each key pair
      for (const obj of objects) {
        console.log(`Processing key: ${obj.publicKey}`);
        const exists = await pool.request()
          .input('publicKey', sql.VarChar, obj.publicKey)
          .query(`
            SELECT 
              (SELECT COUNT(*) FROM KeyPair WHERE PublicKey = @publicKey) +
              CASE 
                WHEN DB_NAME() LIKE '%prod%' OR @@SERVERNAME LIKE '%prod%'
                THEN (SELECT COUNT(*) FROM dev_pubkey WHERE PublicKey = @publicKey)
                ELSE 0
              END as count
          `);
  
        if (exists.recordset[0].count === 0) {
          console.log(`Inserting new key: ${obj.publicKey}`);
          await pool.request()
            .input('publicKey', sql.VarChar, obj.publicKey)
            .input('secretKey', sql.VarChar, obj.secretKey)
            .query(`
              INSERT INTO KeyPair (PublicKey, SecretKey)
              VALUES (@publicKey, @secretKey)
            `);
        } else {
          console.log(`Skipping existing key: ${obj.publicKey}`);
        }
      }
  
      console.log('Successfully processed key pairs');
    } catch (err) {
      console.error('Error processing key pairs:', err.message);
      if (err.code === 'EREQUEST') {
        console.error('SQL Error Details:', {
          code: err.code,
          number: err.number,
          state: err.state,
          class: err.class,
          lineNumber: err.lineNumber,
          serverName: err.serverName,
          procName: err.procName,
        });
      }
    } finally {
      if (pool) {
        await pool.close();
        console.log('Database connection closed');
      }
    }
  }
  
  
  

// Usage
processKeyPair('./solana_vanity_keys.json');