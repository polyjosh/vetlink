import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { color, radius, size, space, type } from '@vetlink/ui-tokens';
import { Text } from './text';

/** Labelled text input; focus shows a primary border. */
export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string | undefined }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.inkMuted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[s.input, props.multiline && s.multiline, focused && s.focused]}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Kenya's country code: the phone field shows it as a fixed prefix. */
export const COUNTRY_CODE = '+254';

/**
 * The number typed after the +254 prefix, as one the API accepts. A pasted full number is kept;
 * a leading 0 is dropped (`0712…` → `+254712…`).
 */
export function withCountryCode(local: string): string {
  const digits = local.replace(/\D/g, '');
  if (digits.startsWith('254')) return `+${digits}`;
  return `${COUNTRY_CODE}${digits.replace(/^0/, '')}`;
}

/** 56 px phone input with a fixed +254 block; focus adds a primarySoft ring. */
export function PhoneInput({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string | undefined }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.ring, focused && s.ringOn]}>
        <View style={[s.phone, focused && s.focused]}>
          <View style={s.prefix} importantForAccessibility="no-hide-descendants">
            <Text style={s.prefixText}>{COUNTRY_CODE}</Text>
          </View>
          <TextInput
            accessibilityLabel={label}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholderTextColor={color.inkMuted}
            {...props}
            onFocus={(e) => {
              setFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              props.onBlur?.(e);
            }}
            style={s.phoneInput}
          />
        </View>
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: space[2], marginBottom: space[3] },
  label: { fontSize: type.small.size, fontWeight: '600' },
  hint: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
  input: {
    minHeight: size.touchMin,
    borderWidth: size.borderStrong,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingHorizontal: space[3],
    fontSize: type.body.size,
    color: color.ink,
  },
  multiline: { minHeight: size.touchMin * 2, textAlignVertical: 'top', paddingTop: space[2] },
  focused: { borderColor: color.primary },
  ring: {
    borderRadius: radius.md + size.focusRing,
    padding: size.focusRing,
    margin: -size.focusRing,
  },
  ringOn: { backgroundColor: color.primarySoft },
  phone: {
    flexDirection: 'row',
    minHeight: size.input,
    borderWidth: size.borderStrong,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  prefix: {
    justifyContent: 'center',
    paddingHorizontal: space[3],
    backgroundColor: color.ground,
    borderRightWidth: size.border,
    borderRightColor: color.border,
  },
  prefixText: { fontSize: type.button.size, fontWeight: '700' },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space[3],
    fontSize: type.button.size,
    color: color.ink,
  },
});
