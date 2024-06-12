// this is a helper function that will throw a random error
// to test out rollbacks during deployment.
export const randomErrors = (
  enabled: string | undefined,
  threshold = 0.75
): void | Error => {
  if (enabled?.toLowerCase() === 'false') return;

  if (Math.random() > threshold) {
    throw new Error('random error!!!');
  }
};
