import { useSync, outbox } from '../offline/sync';
import { useT } from '../lib/i18n';
import { Button, Card, H2, P } from './ui';

/** Writes the server refused after reconnecting (server state wins): shown until dismissed. */
export function SyncFailures() {
  const { t } = useT();
  const failed = useSync((s) => s.items.filter((i) => i.state === 'failed'));
  if (failed.length === 0) return null;
  return (
    <Card>
      <H2>{t.web.mobile.syncFailedTitle}</H2>
      <P>{t.web.mobile.syncFailedHint}</P>
      {failed.map((i) => (
        <P key={i.id} muted>
          {i.op.kind === 'document_upload'
            ? t.web.application.docKinds[i.op.docKind]
            : `#${i.op.bookingId}`}{' '}
          · {i.lastError ?? ''}
        </P>
      ))}
      <Button
        title={t.web.mobile.dismiss}
        variant="secondary"
        onPress={() => {
          for (const i of failed) void outbox.dismiss(i.id);
        }}
      />
    </Card>
  );
}
