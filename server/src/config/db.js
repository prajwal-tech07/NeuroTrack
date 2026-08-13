import mongoose from 'mongoose';
import env from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);

  try {
    const conn = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[db] connected -> ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    console.error(
      '[db] Is MongoDB running? On Windows: `net start MongoDB` (as administrator), ' +
        'or point MONGODB_URI at a MongoDB Atlas cluster.'
    );
    process.exit(1);
  }
}

export default connectDB;
