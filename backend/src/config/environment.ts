interface Environment {
  port: number;
  corsOrigin: string;
  isProduction: boolean;
  database: {
    url: string;
  };
  jwt: {
    secret: string;
  };
}

const environment: Environment = {
  port: parseInt(process.env.PORT || '5001', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  isProduction: process.env.NODE_ENV === 'production',
  database: {
    url: process.env.DATABASE_URL || 'mongodb://localhost:27017/twofold_chess',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-development-secret',
  },
};

export default environment; 