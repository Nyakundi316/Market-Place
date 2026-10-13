import { Thread } from './thread';

export default function ConversationPage({ params }: { params: { id: string } }) {
  return <Thread id={params.id} />;
}
