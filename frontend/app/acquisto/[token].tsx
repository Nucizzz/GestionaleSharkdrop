import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator, Alert, Image, Dimensions, Platform, Pressable, PanResponder } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { api } from '../../src/services/api';
import { Button } from '../../src/components/Button';

interface PurchaseItem {
  product_id?: string;
  variant_id?: string;
  title: string;
  variant_title?: string;
  quantity: number;
  purchase_price: number;
  product_image?: string;
}

interface PublicPurchaseLink {
  id: string;
  items: PurchaseItem[];
  total_amount: number;
  note?: string;
  created_at: string;
  expires_at: string;
  status: string;
  doc_type?: 'acquisto' | 'contovendita';
  error?: string;
  expired?: boolean;
  already_submitted?: boolean;
}

interface Stroke {
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

const SIGNATURE_COLOR = '#111';

export default function PublicPurchaseScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<PublicPurchaseLink | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [birthCountry, setBirthCountry] = useState('');
  const [residenceAddress, setResidenceAddress] = useState('');
  const [residenceCity, setResidenceCity] = useState('');
  const [residenceProvince, setResidenceProvince] = useState('');
  const [residenceCap, setResidenceCap] = useState('');
  const [residenceCountry, setResidenceCountry] = useState('');
  const [fiscalCode, setFiscalCode] = useState('');
  const [iban, setIban] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentStroke = useRef<Stroke | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  const screenWidth = Dimensions.get('window').width;
  const isSmall = screenWidth < 520;
  const isMobileWeb = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const forceSingleColumn = Platform.OS !== 'web' || isMobileWeb;

  const renderInput = (opts: {
    key: string;
    value: string;
    placeholder: string;
    onChange: (v: string) => void;
    error?: string;
    keyboardType?: 'default' | 'email-address' | 'phone-pad';
    autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  }) => (
    <View style={styles.mobileInputGroup} key={opts.key}>
      <TextInput
        style={[styles.mobileInput, opts.error && styles.inputError]}
        placeholder={opts.placeholder}
        value={opts.value}
        onChangeText={opts.onChange}
        allowFontScaling={false}
        keyboardType={opts.keyboardType}
        autoCapitalize={opts.autoCapitalize}
      />
      {!!opts.error && <Text style={styles.errorText}>{opts.error}</Text>}
    </View>
  );
  const signatureBoxWidth = Math.min(screenWidth - 48, 600);
  const signatureBoxHeight = 180;

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      setLoading(true);
      try {
        const result = await api.getPublicPurchaseLink(token);
        setData(result);
      } catch (error: any) {
        const err = error?.response?.data || { error: 'Error loading document' };
        setData({
          id: '',
          items: [],
          total_amount: 0,
          status: 'error',
          ...err,
        } as PublicPurchaseLink);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [token]);

  const totalItems = useMemo(() => data?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0, [data]);
  const docType = data?.doc_type || 'acquisto';

  const clearError = (key: string) => {
    if (!errors[key]) return;
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const clearSignature = () => {
    setStrokes([]);
    currentStroke.current = null;
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (evt) => {
      setIsSigning(true);
      clearError('signature');
      const { locationX, locationY } = evt.nativeEvent;
      const stroke: Stroke = { color: SIGNATURE_COLOR, width: 2.5, points: [{ x: locationX, y: locationY }] };
      currentStroke.current = stroke;
      setStrokes((prev) => [...prev, stroke]);
    },
    onPanResponderMove: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      if (!currentStroke.current) return;
      currentStroke.current.points.push({ x: locationX, y: locationY });
      setStrokes((prev) => [...prev]);
    },
    onPanResponderRelease: () => {
      currentStroke.current = null;
      setIsSigning(false);
    },
    onPanResponderTerminate: () => {
      currentStroke.current = null;
      setIsSigning(false);
    },
  }), []);

  const signatureToSvg = () => {
    if (strokes.length === 0) return '';
    const paths = strokes.map((s) => {
      const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return `<path d="${d}" stroke="${s.color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    }).join('');
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${signatureBoxWidth}" height="${signatureBoxHeight}">${paths}</svg>`)}`;
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.first_name = 'Campo obbligatorio';
    if (!lastName.trim()) next.last_name = 'Campo obbligatorio';
    if (!birthDate.trim()) next.birth_date = 'Campo obbligatorio';
    if (!birthPlace.trim()) next.birth_place = 'Campo obbligatorio';
    if (!birthCountry.trim()) next.birth_country = 'Campo obbligatorio';
    if (!residenceAddress.trim()) next.residence_address = 'Campo obbligatorio';
    if (!residenceCity.trim()) next.residence_city = 'Campo obbligatorio';
    if (!residenceProvince.trim()) next.residence_province = 'Campo obbligatorio';
    if (!residenceCap.trim()) next.residence_cap = 'Campo obbligatorio';
    if (!residenceCountry.trim()) next.residence_country = 'Campo obbligatorio';
    if (!fiscalCode.trim()) next.fiscal_code = 'Campo obbligatorio';
    if (docType === 'acquisto' && !iban.trim()) next.iban = 'Campo obbligatorio';
    if (!phone.trim()) next.phone = 'Campo obbligatorio';
    if (strokes.length === 0) next.signature = 'Firma digitale obbligatoria';
    return next;
  };

  const handleSubmit = async () => {
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).some((k) => fieldErrors[k])) {
      return;
    }

    setSubmitting(true);
    try {
      await api.submitSupplierData(token, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        birth_date: birthDate.trim(),
        birth_place: birthPlace.trim(),
        birth_country: birthCountry.trim(),
        residence_address: residenceAddress.trim(),
        residence_city: residenceCity.trim(),
        residence_province: residenceProvince.trim(),
        residence_cap: residenceCap.trim(),
        residence_country: residenceCountry.trim(),
        fiscal_code: fiscalCode.trim(),
        iban: docType === 'acquisto' ? iban.trim() : undefined,
        signature: signatureToSvg(),
        phone: phone.trim(),
        email: email.trim() || undefined,
      });
      Alert.alert('Thank you!', 'Your details have been submitted.');
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      if (detail?.fields) {
        const next: Record<string, string> = {};
        detail.fields.forEach((f: string) => {
          next[f] = 'Campo obbligatorio';
        });
        setErrors(next);
      }
      Alert.alert('Error', detail?.message || detail || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#111" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (data?.expired || data?.already_submitted || data?.error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorTitle}>{data?.error || 'Invalid link'}</Text>
        <Text style={styles.errorSubtitle}>Contact the seller for a new link.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      scrollEnabled={!isSigning}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Image source={require('../../LOGOSHARKDROP.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>SELL TO SHARKDROP</Text>
        <Text style={styles.subtitle}>Supplier Document Compilation</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Product Information</Text>
        {data?.items?.map((item, idx) => (
          <View key={`${item.title}-${idx}`} style={[styles.itemRow, isSmall && styles.itemRowStack]}>
            <View style={[styles.itemImageWrap, isSmall && styles.itemImageWrapSmall]}>
              {item.product_image ? (
                <Image source={{ uri: item.product_image }} style={styles.itemImage} resizeMode="cover" />
              ) : (
                <View style={styles.itemPlaceholder}>
                  <Text style={styles.itemPlaceholderText}>NO PHOTO</Text>
                </View>
              )}
            </View>
            <View style={[styles.itemInfo, isSmall && styles.itemInfoStack]}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {item.variant_title ? <Text style={styles.itemVariant}>{item.variant_title}</Text> : null}
              {docType === 'acquisto' && (
                <Text style={styles.itemPrice}>Supplier Cost: {'\u20AC'}{item.purchase_price.toFixed(2)}</Text>
              )}
              <Text style={styles.itemQty}>Qty: {item.quantity}</Text>
            </View>
          </View>
        ))}
        {docType === 'acquisto' && (
          <View style={styles.totalRow}>
            <Text style={styles.totalText}>Total Cost</Text>
            <Text style={styles.totalValue}>{'\u20AC'}{data?.total_amount.toFixed(2)}</Text>
          </View>
        )}
        {data?.note ? <Text style={styles.note}>Note: {data.note}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Personal Information</Text>
        {isMobileWeb ? (
          <>
            {renderInput({ key: 'first_name', value: firstName, placeholder: 'First name', onChange: (v) => { setFirstName(v); clearError('first_name'); }, error: errors.first_name })}
            {renderInput({ key: 'last_name', value: lastName, placeholder: 'Last name', onChange: (v) => { setLastName(v); clearError('last_name'); }, error: errors.last_name })}
            {renderInput({ key: 'birth_date', value: birthDate, placeholder: 'Date of birth (DD/MM/YYYY)', onChange: (v) => { setBirthDate(v); clearError('birth_date'); }, error: errors.birth_date })}
            {renderInput({ key: 'birth_place', value: birthPlace, placeholder: 'Place of birth', onChange: (v) => { setBirthPlace(v); clearError('birth_place'); }, error: errors.birth_place })}
            {renderInput({ key: 'birth_country', value: birthCountry, placeholder: 'Country of birth', onChange: (v) => { setBirthCountry(v); clearError('birth_country'); }, error: errors.birth_country })}
            {renderInput({ key: 'residence_address', value: residenceAddress, placeholder: 'Residential address', onChange: (v) => { setResidenceAddress(v); clearError('residence_address'); }, error: errors.residence_address })}
            {renderInput({ key: 'residence_city', value: residenceCity, placeholder: 'City', onChange: (v) => { setResidenceCity(v); clearError('residence_city'); }, error: errors.residence_city })}
            {renderInput({ key: 'residence_province', value: residenceProvince, placeholder: 'Province', onChange: (v) => { setResidenceProvince(v); clearError('residence_province'); }, error: errors.residence_province })}
            {renderInput({ key: 'residence_cap', value: residenceCap, placeholder: 'Postal code', onChange: (v) => { setResidenceCap(v); clearError('residence_cap'); }, error: errors.residence_cap })}
            {renderInput({ key: 'residence_country', value: residenceCountry, placeholder: 'State', onChange: (v) => { setResidenceCountry(v); clearError('residence_country'); }, error: errors.residence_country })}
          </>
        ) : (
          <>
            <View style={[styles.row, (isSmall || forceSingleColumn) && styles.rowStack]}>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.first_name && styles.inputError]}
                  placeholder="First name"
                  value={firstName}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setFirstName(v);
                    clearError('first_name');
                  }}
                />
                {!!errors.first_name && <Text style={styles.errorText}>{errors.first_name}</Text>}
              </View>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.last_name && styles.inputError]}
                  placeholder="Last name"
                  value={lastName}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setLastName(v);
                    clearError('last_name');
                  }}
                />
                {!!errors.last_name && <Text style={styles.errorText}>{errors.last_name}</Text>}
              </View>
            </View>
            <View style={[styles.row, (isSmall || forceSingleColumn) && styles.rowStack]}>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.birth_date && styles.inputError]}
                  placeholder="Date of birth (DD/MM/YYYY)"
                  value={birthDate}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setBirthDate(v);
                    clearError('birth_date');
                  }}
                />
                {!!errors.birth_date && <Text style={styles.errorText}>{errors.birth_date}</Text>}
              </View>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.birth_place && styles.inputError]}
                  placeholder="Place of birth"
                  value={birthPlace}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setBirthPlace(v);
                    clearError('birth_place');
                  }}
                />
                {!!errors.birth_place && <Text style={styles.errorText}>{errors.birth_place}</Text>}
              </View>
            </View>
            <View style={styles.inputGroup}>
              <TextInput
                style={[styles.inputFull, errors.birth_country && styles.inputError]}
                placeholder="Country of birth"
                value={birthCountry}
                allowFontScaling={false}
                onChangeText={(v) => {
                  setBirthCountry(v);
                  clearError('birth_country');
                }}
              />
              {!!errors.birth_country && <Text style={styles.errorText}>{errors.birth_country}</Text>}
            </View>
            <View style={styles.inputGroup}>
              <TextInput
                style={[styles.inputFull, errors.residence_address && styles.inputError]}
                placeholder="Residential address"
                value={residenceAddress}
                allowFontScaling={false}
                onChangeText={(v) => {
                  setResidenceAddress(v);
                  clearError('residence_address');
                }}
              />
              {!!errors.residence_address && <Text style={styles.errorText}>{errors.residence_address}</Text>}
            </View>
            <View style={[styles.row, (isSmall || forceSingleColumn) && styles.rowStack]}>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.residence_city && styles.inputError]}
                  placeholder="City"
                  value={residenceCity}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setResidenceCity(v);
                    clearError('residence_city');
                  }}
                />
                {!!errors.residence_city && <Text style={styles.errorText}>{errors.residence_city}</Text>}
              </View>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.residence_province && styles.inputError]}
                  placeholder="Province"
                  value={residenceProvince}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setResidenceProvince(v);
                    clearError('residence_province');
                  }}
                />
                {!!errors.residence_province && <Text style={styles.errorText}>{errors.residence_province}</Text>}
              </View>
            </View>
            <View style={[styles.row, (isSmall || forceSingleColumn) && styles.rowStack]}>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.residence_cap && styles.inputError]}
                  placeholder="Postal code"
                  value={residenceCap}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setResidenceCap(v);
                    clearError('residence_cap');
                  }}
                />
                {!!errors.residence_cap && <Text style={styles.errorText}>{errors.residence_cap}</Text>}
              </View>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.residence_country && styles.inputError]}
                  placeholder="State"
                  value={residenceCountry}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setResidenceCountry(v);
                    clearError('residence_country');
                  }}
                />
                {!!errors.residence_country && <Text style={styles.errorText}>{errors.residence_country}</Text>}
              </View>
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Legal</Text>
        {isMobileWeb ? (
          <>
            {renderInput({ key: 'fiscal_code', value: fiscalCode, placeholder: 'Fiscal code', onChange: (v) => { setFiscalCode(v); clearError('fiscal_code'); }, error: errors.fiscal_code, autoCapitalize: 'characters' })}
            {docType === 'acquisto' && renderInput({ key: 'iban', value: iban, placeholder: 'IBAN', onChange: (v) => { setIban(v); clearError('iban'); }, error: errors.iban, autoCapitalize: 'characters' })}
            {renderInput({ key: 'phone', value: phone, placeholder: 'Phone *', onChange: (v) => { setPhone(v); clearError('phone'); }, error: errors.phone, keyboardType: 'phone-pad' })}
            <View style={styles.mobileInputGroup}>
              <TextInput
                style={styles.mobileInput}
                placeholder="Email (optional)"
                value={email}
                allowFontScaling={false}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <TextInput
                style={[styles.inputFull, errors.fiscal_code && styles.inputError]}
                placeholder="Fiscal code"
                value={fiscalCode}
                allowFontScaling={false}
                onChangeText={(v) => {
                  setFiscalCode(v);
                  clearError('fiscal_code');
                }}
                autoCapitalize="characters"
              />
              {!!errors.fiscal_code && <Text style={styles.errorText}>{errors.fiscal_code}</Text>}
            </View>
            {docType === 'acquisto' && (
              <View style={styles.inputGroup}>
                <TextInput
                  style={[styles.inputFull, errors.iban && styles.inputError]}
                  placeholder="IBAN"
                  value={iban}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setIban(v);
                    clearError('iban');
                  }}
                  autoCapitalize="characters"
                />
                {!!errors.iban && <Text style={styles.errorText}>{errors.iban}</Text>}
              </View>
            )}
            <View style={[styles.row, (isSmall || forceSingleColumn) && styles.rowStack]}>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={[styles.input, errors.phone && styles.inputError]}
                  placeholder="Phone *"
                  value={phone}
                  allowFontScaling={false}
                  onChangeText={(v) => {
                    setPhone(v);
                    clearError('phone');
                  }}
                  keyboardType="phone-pad"
                />
                {!!errors.phone && <Text style={styles.errorText}>{errors.phone}</Text>}
              </View>
              <View style={[styles.fieldBlock, isSmall && styles.fieldBlockStack]}>
                <TextInput
                  style={styles.input}
                  placeholder="Email (optional)"
                  value={email}
                  allowFontScaling={false}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Seller Signature</Text>
        <Text style={styles.signatureHint}>Draw your signature below *</Text>
        {!!errors.signature && <Text style={styles.errorText}>{errors.signature}</Text>}
        <View style={[styles.signatureBox, { width: signatureBoxWidth, height: signatureBoxHeight }]} {...panResponder.panHandlers}>
          <Svg width={signatureBoxWidth} height={signatureBoxHeight}>
            {strokes.map((stroke, idx) => {
              const d = stroke.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
              return <Path key={idx} d={d} stroke={stroke.color} strokeWidth={stroke.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
            })}
          </Svg>
        </View>
        <View style={styles.signatureActions}>
          <Pressable onPress={clearSignature} style={styles.signatureBtnGhost}>
            <Text style={styles.signatureBtnGhostText}>Clear</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <Button title={submitting ? 'Submitting...' : 'Complete Document'} onPress={handleSubmit} loading={submitting} />
        <Text style={styles.footerHint}>Your data will be stored securely.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef2f7',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#555',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 1.2,
  },
  subtitle: {
    marginTop: 6,
    color: '#475569',
  },
  card: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    marginBottom: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0px 6px 16px rgba(0,0,0,0.06)',
      },
    }),
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
    color: '#0f172a',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingVertical: 14,
  },
  itemRowStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  itemImageWrap: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    overflow: 'hidden',
    backgroundColor: '#fafafa',
  },
  itemImageWrapSmall: {
    width: 56,
    height: 56,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  itemPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPlaceholderText: {
    fontSize: 10,
    color: '#999',
    letterSpacing: 1,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
  },
  itemInfoStack: {
    marginLeft: 0,
    width: '100%',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  itemVariant: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 13,
    color: '#2563eb',
    marginTop: 6,
  },
  itemQty: {
    fontSize: 12,
    color: '#444',
    marginTop: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  totalText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 16,
    color: '#1d4ed8',
    fontWeight: '700',
  },
  note: {
    marginTop: 8,
    color: '#666',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
    flexWrap: 'wrap',
  },
  fieldBlock: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 200,
    marginBottom: 14,
  },
  fieldBlockStack: {
    marginBottom: 14,
  },
  rowStack: {
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    marginBottom: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    backgroundColor: '#fafafa',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    fontSize: 14,
    minHeight: 52,
    lineHeight: 20,
  },
  inputError: {
    borderColor: '#dc2626',
  },
  inputFull: {
    width: '100%',
    backgroundColor: '#fafafa',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    fontSize: 14,
    marginBottom: 0,
    minHeight: 52,
    lineHeight: 20,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 12,
    marginTop: 6,
    marginBottom: 0,
  },
  mobileInputGroup: {
    width: '100%',
    marginBottom: 14,
  },
  mobileInput: {
    width: '100%',
    backgroundColor: '#fafafa',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    fontSize: 14,
    minHeight: 56,
    lineHeight: 22,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 14,
  },
  signatureHint: {
    color: '#334155',
    marginBottom: 10,
  },
  signatureBox: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 12,
    backgroundColor: '#fff',
    alignSelf: 'center',
  },
  signatureActions: {
    marginTop: 12,
  },
  signatureBtnGhost: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#111',
  },
  signatureBtnGhostText: {
    fontWeight: '600',
    color: '#111',
  },
  footer: {
    width: '100%',
    maxWidth: 720,
    gap: 8,
  },
  footerHint: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
  },
  errorSubtitle: {
    marginTop: 8,
    color: '#666',
    textAlign: 'center',
  },
});


