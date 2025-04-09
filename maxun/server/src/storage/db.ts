import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

// Extract the hostname using the URL constructor
const host = new URL(databaseUrl).hostname;

const sequelize = new Sequelize(databaseUrl,
    {
        host,
        dialect: 'postgres',
        logging: false,
    }
);

export const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
};

export const syncDB = async () => {
    try {
        //setupAssociations();
        const isDevelopment = process.env.NODE_ENV === 'development';
        // force: true will drop and recreate tables on every run
        // Use `alter: true` only in development mode
        await sequelize.sync({ 
            force: false, 
            alter: isDevelopment 
        }); 
        console.log('Database synced successfully!');
    } catch (error) {
        console.error('Failed to sync database:', error);
    }
};


export default sequelize;