import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { View } from 'react-native';
import { DOCUMENT_MAX_BYTES, type VetDocumentKind } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { space } from '@vetlink/ui-tokens';
import { enqueue, useSync } from '../offline/sync';
import { useT } from '../lib/i18n';
import { Badge, Button, P, s } from './ui';

type Doc = Schemas['VetApplication']['documents'][number];

/**
 * Photograph a document, shrink it on the phone, and queue the upload (§11: compress first, upload
 * in the background with retry). The outbox sends it when there is a connection.
 */
export function DocCapture({
  kind,
  doc,
  disabled,
}: {
  kind: VetDocumentKind;
  doc: Doc | undefined;
  disabled: boolean;
}) {
  const { t } = useT();
  const queued = useSync((st) =>
    st.items.some(
      (i) => i.op.kind === 'document_upload' && i.op.docKind === kind && i.state === 'pending',
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const a = t.web.application;

  async function pick(source: 'camera' | 'library') {
    setError(null);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(a.uploadFailed);
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 1,
      cameraType:
        kind === 'profile_photo' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    // 1600 px wide JPEG keeps text readable for reviewers at a fraction of the size.
    const ref = await ImageManipulator.manipulate(asset.uri)
      .resize({ width: Math.min(asset.width || 1600, 1600) })
      .renderAsync();
    const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    const size = (await (await fetch(out.uri)).blob()).size;
    if (size > DOCUMENT_MAX_BYTES) return setError(a.uploadFailed);
    await enqueue({
      kind: 'document_upload',
      docKind: kind,
      fileUri: out.uri,
      contentType: 'image/jpeg',
      size,
    });
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: '#D5DBD7',
        borderRadius: 10,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View style={s.row}>
        <P>{a.docKinds[kind]}</P>
        {queued ? (
          <Badge tone="warning">{a.uploading}</Badge>
        ) : doc?.status === 'flagged' ? (
          <Badge tone="danger">{a.flagged}</Badge>
        ) : doc ? (
          <Badge tone="success">{a.uploaded}</Badge>
        ) : null}
      </View>
      {doc?.flagReason && <P muted>{doc.flagReason}</P>}
      <View style={s.row}>
        <Button
          title={t.web.mobile.takePhoto}
          disabled={disabled}
          onPress={() => void pick('camera')}
        />
        <Button
          title={t.web.mobile.choosePhoto}
          variant="secondary"
          disabled={disabled}
          onPress={() => void pick('library')}
        />
      </View>
      {error && <P muted>{error}</P>}
    </View>
  );
}
