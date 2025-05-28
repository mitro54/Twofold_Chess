const environment = {
  apiUrl: process.env.DOCKER_ENV ? "http://backend:5001" : "http://192.168.100.135:5001",
  isProduction: process.env.NODE_ENV === 'production',
  auth: {
    url: process.env.NEXTAUTH_URL || 'http://localhost:3000',
  },
};

export default environment; 