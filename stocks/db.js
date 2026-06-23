const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mutual_funds';

const connectToDatabase = async () => {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || undefined });
    return mongoose.connection;
};

const closeDatabase = async () => {
    await mongoose.disconnect();
};

module.exports = {
    connectToDatabase,
    closeDatabase,
    mongoose,
};
