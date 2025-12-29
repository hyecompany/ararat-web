'use client';


import { useUser } from "@/app/_hooks/user";
import { createContext, use } from 'react';
import IsClientContext from '@/app/_context/isClient';

export interface UserContextData {
  id: string;
  name?: string;
  email?: string;
  picture?: string;
}

const UserContext = createContext({
  data: null as UserContextData | null,
  isLoading: true,
  isValidating: true,
});
export default UserContext;

export function UserProvider({ children }: { children: React.ReactNode }) {
  const {
    data,
    isLoading: userIsLoading,
    isValidating: userIsValidating,
  } = useUser();
  const isClient = use(IsClientContext);

  return (
    <UserContext.Provider
      value={{
        data,
        isLoading: userIsLoading || !isClient,
        isValidating: userIsValidating || !isClient,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
