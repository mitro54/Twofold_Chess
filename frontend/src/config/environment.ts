const environment = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001',
  isProduction: process.env.NODE_ENV === 'production',
  auth: {
    url: process.env.NEXTAUTH_URL || 'http://localhost:3000',
  },
};

export default environment; 