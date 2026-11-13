import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'project'; id: string };

function parse(): Route {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  return m ? { name: 'project', id: m[1] } : { name: 'home' };
}

export const goHome = () => { location.hash = '#/'; };
export const goProject = (id: string) => { location.hash = `#/p/${id}`; };

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const h = () => setR(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}
