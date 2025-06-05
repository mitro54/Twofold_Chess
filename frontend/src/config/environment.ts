const environment = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'https://twofoldchess.com/api',
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || 'https://twofoldchess.com',
  isProduction: process.env.NODE_ENV === 'production',
  auth: {
    url: process.env.NEXTAUTH_URL || 'https://twofoldchess.com',
  },
};

export default environment; 