import { GetServerSideProps } from "next";
import { getProviders, signIn, ClientSafeProvider, useSession } from "next-auth/react";
import ReturnToMainMenu from "../../components/ReturnToMainMenu";
import { useEffect } from "react";
import { useRouter } from "next/router";

interface SignInProps {
  providers: Record<string, ClientSafeProvider> | null;
}

export const getServerSideProps: GetServerSideProps<SignInProps> = async () => {
  const providers = await getProviders();
  return {
    props: {
      providers,
    },
  };
};

const SignIn = ({ providers }: SignInProps) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/history");
    }
  }, [status, router]);

  if (status === "authenticated") {
    return null;
  }

  if (!providers) {
    return <div className="text-center mt-10">Error loading providers</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-6">Sign in to view history.</h1>
      <div className="flex flex-col items-center gap-4">
        {Object.values(providers).map((provider) => (
          <button
            key={provider.id}
            onClick={() => signIn(provider.id, { callbackUrl: "/history" })}
            className="bg-gray-800 text-white px-6 py-3 rounded-md hover:bg-gray-700 flex items-center gap-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/github.svg"
              alt={`${provider.name} logo`}
              className="w-6 h-6"
            />
            Sign in with {provider.name}
          </button>
        ))}

        <div className="mt-0">
          <ReturnToMainMenu />
        </div>
      </div>
    </div>
  );
};

export default SignIn;