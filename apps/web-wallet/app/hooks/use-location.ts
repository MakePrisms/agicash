import { useRouteLoaderData } from 'react-router';

const useLocationData = () => {
  const { domain, origin } = useRouteLoaderData('root') ?? {};

  if (
    !domain ||
    typeof domain !== 'string' ||
    !origin ||
    typeof origin !== 'string'
  ) {
    throw new Error('Domain or origin not found');
  }

  return { domain, origin };
};

export default useLocationData;
