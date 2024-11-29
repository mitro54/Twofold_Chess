import { GetServerSideProps } from 'next';
import { getProviders, signIn, ClientSafeProvider } from 'next-auth/react';

interface SignInProps {
  providers: Record<string, ClientSafeProvider> | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getServerSideProps: GetServerSideProps<SignInProps> = async (context) => {
  const providers = await getProviders();
  console.log('Providers:', providers);

  return {
    props: {
      providers,
    },
  };
};

const SignIn = ({ providers }: SignInProps) => {
  if (!providers) {
    return <div>Error loading providers</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold mb-6">Sign in to View History</h1>
      {Object.values(providers).map((provider) => (
        <button
          key={provider.id}
          onClick={() => signIn(provider.id, { callbackUrl: '/history' })}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Sign in with {provider.name}
        </button>
      ))}
    </div>
  );
};

export default SignIn;