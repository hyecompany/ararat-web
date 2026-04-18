import { SiteHeader } from '@/app/(main)/_components/header';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
} from 'ui-web/components/breadcrumb';

export default function OperationsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <SiteHeader>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbPage>Operations</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </SiteHeader>
            <div className="min-h-0 flex-1 overflow-auto p-4 lg:px-6">
                {children}
            </div>
        </div>
    );
}
