export const safeBack = (router: { canGoBack?: () => boolean; back: () => void; replace: (path: string) => void }) => {
  if (router.canGoBack && router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(tabs)');
  }
};
