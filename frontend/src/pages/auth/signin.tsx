import { GetServerSideProps } from "next";
import { getProviders, signIn, ClientSafeProvider, useSession } from "next-auth/react";
import ReturnToMainMenu from "../../components/ReturnToMainMenu";
import { useEffect } from "react";
import { useRouter } from "next/router";
import PageLayout from "../../components/PageLayout";

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
  const { status } = useSession();
  const router = useRouter();
  const callbackUrl = router.query.callbackUrl as string || "/history";

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  if (status === "authenticated") {
    return null;
  }

  if (!providers) {
    return (
      <PageLayout>
        <div className="text-center mt-10 text-white">Error loading providers</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Sign In">
      <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-white mb-2">Sign in to view all saved game data</h2>
          <p className="text-gray-400">You can also download datasets or search for specific games or statistics</p>
        </div>
        
        <div className="flex flex-col items-center gap-4 w-full max-w-[280px]">
          {Object.values(providers).map((provider) => (
            <button
              key={provider.id}
              onClick={() => signIn(provider.id, { callbackUrl })}
              className="w-full px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] flex items-center justify-center gap-2 group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/github.svg"
                alt={`${provider.name} logo`}
                className="w-6 h-6"
              />
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent group-hover:from-indigo-300 group-hover:to-purple-300 transition-colors">
                Sign in with {provider.name}
              </span>
            </button>
          ))}

          <div className="mt-8">
            <ReturnToMainMenu />
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default SignIn;