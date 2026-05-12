'use client';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import ImportCertificate from './import';
import CreateCertificate from './create';

import AlreadyAuthenticated from '../../_components/alreadyAuthenticated';

export default function TlsOptions() {
  return (
    <>
      <AlreadyAuthenticated />
      <Tabs defaultValue="create" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="create">Create New</TabsTrigger>
          <TabsTrigger value="import">Import Existing</TabsTrigger>
        </TabsList>
        <TabsContent value="import">
          <ImportCertificate />
        </TabsContent>
        <TabsContent value="create">
          <CreateCertificate />
        </TabsContent>
      </Tabs>
    </>
  );
}
