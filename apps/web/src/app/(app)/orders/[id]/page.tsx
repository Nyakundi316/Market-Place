import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderView } from './order-view';

export const metadata: Metadata = { title: 'Order' };

export default function OrderPage({ params }: { params: { id: string } }) {
  return (
    <Suspense>
      <OrderView id={params.id} />
    </Suspense>
  );
}
