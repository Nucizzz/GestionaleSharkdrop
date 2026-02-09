import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Image, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { safeBack } from '../src/utils/safeBack';

type LookupItem = {
  id: string;
  barcode: string;
  status: string;
  match?: any;
  created_at?: string;
  error?: string;
};

type ImportJob = {
  id: string;
  barcode: string;
  stockx_url: string;
  status: string;
  created_at?: string;
};

export default function CaricaProdottiOnlineScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const params = useLocalSearchParams();

  const barcodeParam = typeof params.barcode === 'string' ? params.barcode : '';
  const lookupIdParam = typeof params.lookup_id === 'string' ? params.lookup_id : '';

  const [lookup, setLookup] = useState<LookupItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [history, setHistory] = useState<LookupItem[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);

  const [productType, setProductType] = useState('Scarpe');
  const [expressMode, setExpressMode] = useState<'all' | 'none'>('none');
  const [expressLabel, setExpressLabel] = useState('Express 24/48H');
  const [priceMode, setPriceMode] = useState<'fixed' | 'market'>('fixed');
  const [fixedPrice, setFixedPrice] = useState('220');
  const [priceTypePreferred, setPriceTypePreferred] = useState('standard');
  const [sizeMode, setSizeMode] = useState<'all' | 'range' | 'list'>('range');
  const [euMin, setEuMin] = useState('35');
  const [euMax, setEuMax] = useState('49.5');
  const [euList, setEuList] = useState('');
  const [tags, setTags] = useState('Sneakers,StockX Import, NOMODIFICA');
  const [templateSuffix, setTemplateSuffix] = useState('default');
  const [defaultQty, setDefaultQty] = useState('0');
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [showStockxPopup, setShowStockxPopup] = useState(false);

  const lookupMatch = lookup?.match || null;
  const manualStockxUrl = useMemo(() => {
    const raw = manualInput.trim();
    if (!raw) return '';
    if (/stockx\.com\/.+/i.test(raw)) return raw;
    if (/^[a-z0-9][a-z0-9-]{2,}$/i.test(raw)) return `https://stockx.com/${raw}`;
    return '';
  }, [manualInput]);
  const stockxUrl = lookupMatch?.stockx_url || manualStockxUrl || '';

  const canImport = useMemo(() => {
    if (!stockxUrl) return false;
    if (priceMode === 'fixed' && !fixedPrice.trim()) return false;
    if (sizeMode === 'range' && !euMin.trim() && !euMax.trim()) return false;
    if (sizeMode === 'list' && !euList.trim()) return false;
    return true;
  }, [stockxUrl, priceMode, fixedPrice, sizeMode, euMin, euMax, euList]);

  const loadHistory = async () => {
    if (user?.role !== 'admin') return;
    try {
      const [lookups, importsData] = await Promise.all([
        api.getStockxLookups(),
        api.getStockxImports(),
      ]);
      setHistory(lookups.items || []);
      setImports(importsData.items || []);
    } catch (error) {
      // Silent fail for non-admin
    }
  };

  const runLookup = async (barcode: string) => {
    if (!barcode) return;
    setLookupLoading(true);
    try {
      const res = await api.stockxLookupBarcode(barcode);
      setLookup({
        id: res.lookup_id,
        barcode,
        status: res.status,
        match: res.match,
      });
      loadHistory();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nella ricerca StockX');
    } finally {
      setLookupLoading(false);
    }
  };

  useEffect(() => {
    if (barcodeParam) {
      runLookup(barcodeParam);
    }
  }, [barcodeParam]);

  useEffect(() => {
    loadHistory();
  }, [user?.role]);

  useEffect(() => {
    if (lookup && lookup.status === 'not_found') {
      setShowStockxPopup(true);
    }
  }, [lookup?.status]);

  const parseFloatSafe = (value: string) => {
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return undefined;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : undefined;
  };

  const parseSizeList = (value: string) => {
    return value
      .split(',')
      .map((p) => parseFloatSafe(p))
      .filter((p): p is number => typeof p === 'number');
  };

  const handleImport = async () => {
    if (!canImport) return;
    Alert.alert(
      'Conferma importazione',
      'Vuoi caricare questo prodotto su Shopify con le opzioni selezionate?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Importa',
          onPress: async () => {
            try {
              setSaving(true);
              const payload: any = {
                barcode: barcodeParam || lookup?.barcode,
                stockx_url: stockxUrl,
                product_type: productType,
                price_mode: priceMode,
                fixed_price_eur: priceMode === 'fixed' ? Number(fixedPrice.replace(',', '.')) : undefined,
                price_type_preferred: priceMode === 'market' ? priceTypePreferred : undefined,
                size_mode: sizeMode,
                eu_min: sizeMode === 'range' ? parseFloatSafe(euMin) : undefined,
                eu_max: sizeMode === 'range' ? parseFloatSafe(euMax) : undefined,
                eu_list: sizeMode === 'list' ? parseSizeList(euList) : undefined,
                express_mode: expressMode,
                express_label: expressMode === 'all' ? expressLabel : undefined,
                tags: tags.trim() || undefined,
                template_suffix: templateSuffix.trim() || undefined,
                default_qty: Number(defaultQty || 0),
                lookup_id: lookupIdParam || lookup?.id,
              };
              await api.importStockxProduct(payload);
              const okMsg = 'Importazione avviata. Tra circa 2 minuti verrà aggiornata la sincronizzazione.';
              setImportStatus(okMsg);
              Alert.alert('Avviato', okMsg);
              setTimeout(() => {
                loadHistory();
              }, 120000);
            } catch (error: any) {
              const errMsg = error.response?.data?.detail || 'Errore durante importazione';
              setImportStatus(errMsg);
              Alert.alert('Errore', errMsg);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleManualLookup = async () => {
    const raw = manualInput.trim();
    if (!raw) {
      Alert.alert('Errore', 'Incolla link, nome esatto o slug StockX');
      return;
    }
    try {
      setManualLoading(true);
      let res: any;
      if (/stockx\.com\/.+/i.test(raw)) {
        res = await api.stockxLookupUrl(raw, barcodeParam || lookup?.barcode || '');
      } else if (/^[a-z0-9][a-z0-9-]{2,}$/i.test(raw)) {
        res = await api.stockxLookupUrl(`https://stockx.com/${raw}`, barcodeParam || lookup?.barcode || '');
      } else {
        res = await api.stockxLookupQuery(raw, barcodeParam || lookup?.barcode || '');
      }
      setLookup({
        id: lookup?.id || 'manual',
        barcode: barcodeParam || lookup?.barcode || '',
        status: 'found',
        match: res,
      });
    } catch (error: any) {
      const errMsg = error.response?.data?.detail || 'Prodotto non trovato su StockX';
      setImportStatus(errMsg);
      Alert.alert('Errore', errMsg);
    } finally {
      setManualLoading(false);
    }
  };

  const openStockxSearch = () => {
    Linking.openURL('https://stockx.com/search');
    setShowStockxPopup(false);
    setLookup(null);
    setManualInput('');
    setImportStatus('');
    if (barcodeParam) {
      router.replace('/caricaprodottionline');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => safeBack(router)}>
          <Ionicons name="arrow-back" size={22} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Carica Prodotti Online</Text>
          <Text style={styles.subtitle}>Cerca da barcode e importa da StockX</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Modal
          transparent
          visible={showStockxPopup}
          animationType="fade"
          onRequestClose={() => setShowStockxPopup(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Vai a StockX</Text>
              <Text style={styles.modalText}>
                Nessuna corrispondenza trovata. Apri StockX, copia il link o il nome esatto del prodotto e incollalo qui sotto.
              </Text>
              <View style={styles.modalRow}>
                <TouchableOpacity style={styles.modalButton} onPress={openStockxSearch}>
                  <Text style={styles.modalButtonText}>Apri StockX</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalButtonGhost} onPress={() => setShowStockxPopup(false)}>
                  <Text style={styles.modalButtonGhostText}>Ho il link</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Barcode</Text>
          <Text style={styles.cardValue}>{barcodeParam || lookup?.barcode || 'Nessun barcode'}</Text>
          {lookupLoading && <Text style={styles.muted}>Ricerca in corso...</Text>}
          {!lookupLoading && lookup && lookup.status === 'not_found' && (
            <Text style={styles.errorText}>
              {lookup.error ? `Nessuna corrispondenza: ${lookup.error}` : 'Nessuna corrispondenza trovata su StockX.'}
            </Text>
          )}
          {!lookupLoading && lookup && lookup.status === 'error' && (
            <Text style={styles.errorText}>Errore nella ricerca: {lookup.error || 'controlla credenziali Kicks'}</Text>
          )}
        </View>

        {lookupMatch && (
          <View style={styles.matchCard}>
            <View style={styles.matchHeader}>
              <Text style={styles.matchTitle}>{lookupMatch.title || 'Prodotto trovato'}</Text>
              <Text style={styles.matchBrand}>{lookupMatch.brand || ''}</Text>
              {lookupMatch.verified === false && (
                <Text style={styles.warningText}>Corrispondenza non verificata: controlla il prodotto.</Text>
              )}
            </View>
            {lookupMatch.image_url && (
              <Image source={{ uri: lookupMatch.image_url }} style={styles.matchImage} />
            )}
            {stockxUrl ? <Text style={styles.matchLink}>{stockxUrl}</Text> : null}
          </View>
        )}

        {!!importStatus && (
          <View style={styles.infoBanner}>
            <Text style={styles.infoText}>{importStatus}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Incolla link / nome / slug StockX</Text>
          <TextInput
            style={styles.input}
            value={manualInput}
            onChangeText={setManualInput}
            placeholder="https://stockx.com/... oppure nome o slug"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.primaryButton, manualLoading && styles.primaryButtonDisabled]}
            onPress={handleManualLookup}
            disabled={manualLoading}
          >
            <Text style={styles.primaryButtonText}>
              {manualLoading ? 'Verifico...' : 'Cerca su StockX'}
            </Text>
          </TouchableOpacity>
        </View>

        {user?.role === 'admin' ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Opzioni Importazione</Text>

              <View style={styles.field}>
                <Text style={styles.label}>Tipo Prodotto</Text>
                <View style={styles.row}>
                  {['Scarpe', 'Altro'].map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[styles.choice, productType === item && styles.choiceActive]}
                      onPress={() => setProductType(item)}
                    >
                      <Text style={[styles.choiceText, productType === item && styles.choiceTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Taglie Express</Text>
                <View style={styles.row}>
                  {[
                    { label: 'Tutte Express', value: 'all' },
                    { label: 'Nessuna Express', value: 'none' },
                  ].map((item) => (
                    <TouchableOpacity
                      key={item.value}
                      style={[styles.choice, expressMode === item.value && styles.choiceActive]}
                      onPress={() => setExpressMode(item.value as 'all' | 'none')}
                    >
                      <Text style={[styles.choiceText, expressMode === item.value && styles.choiceTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {expressMode === 'all' && (
                  <TextInput
                    style={styles.input}
                    value={expressLabel}
                    onChangeText={setExpressLabel}
                    placeholder="Etichetta Express"
                  />
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Prezzo</Text>
                <View style={styles.row}>
                  {[
                    { label: 'Prezzo Fisso', value: 'fixed' },
                    { label: 'Prezzo StockX', value: 'market' },
                  ].map((item) => (
                    <TouchableOpacity
                      key={item.value}
                      style={[styles.choice, priceMode === item.value && styles.choiceActive]}
                      onPress={() => setPriceMode(item.value as 'fixed' | 'market')}
                    >
                      <Text style={[styles.choiceText, priceMode === item.value && styles.choiceTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {priceMode === 'fixed' ? (
                  <TextInput
                    style={styles.input}
                    value={fixedPrice}
                    onChangeText={setFixedPrice}
                    placeholder="Prezzo fisso (EUR)"
                    keyboardType="numeric"
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    value={priceTypePreferred}
                    onChangeText={setPriceTypePreferred}
                    placeholder="standard / market"
                  />
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Taglie da importare</Text>
                <View style={styles.row}>
                  {[
                    { label: 'Tutte', value: 'all' },
                    { label: 'Range', value: 'range' },
                    { label: 'Lista', value: 'list' },
                  ].map((item) => (
                    <TouchableOpacity
                      key={item.value}
                      style={[styles.choice, sizeMode === item.value && styles.choiceActive]}
                      onPress={() => setSizeMode(item.value as 'all' | 'range' | 'list')}
                    >
                      <Text style={[styles.choiceText, sizeMode === item.value && styles.choiceTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {sizeMode === 'range' && (
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, styles.inputHalf]}
                      value={euMin}
                      onChangeText={setEuMin}
                      placeholder="EU min"
                      keyboardType="numeric"
                    />
                    <TextInput
                      style={[styles.input, styles.inputHalf]}
                      value={euMax}
                      onChangeText={setEuMax}
                      placeholder="EU max"
                      keyboardType="numeric"
                    />
                  </View>
                )}
                {sizeMode === 'list' && (
                  <TextInput
                    style={styles.input}
                    value={euList}
                    onChangeText={setEuList}
                    placeholder="Es: 40, 41, 42.5"
                  />
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Tags</Text>
                <TextInput style={styles.input} value={tags} onChangeText={setTags} placeholder="Tags" />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Template Suffix</Text>
                <TextInput
                  style={styles.input}
                  value={templateSuffix}
                  onChangeText={setTemplateSuffix}
                  placeholder="Default"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Default QTY</Text>
                <TextInput
                  style={styles.input}
                  value={defaultQty}
                  onChangeText={setDefaultQty}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, (!canImport || saving) && styles.primaryButtonDisabled]}
                onPress={handleImport}
                disabled={!canImport || saving}
              >
                <Text style={styles.primaryButtonText}>
                  {saving ? 'Importazione...' : 'Importa su Shopify'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Storico Ricerche</Text>
              {history.length === 0 ? (
                <Text style={styles.muted}>Nessuna ricerca.</Text>
              ) : (
                history.map((item) => (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyBarcode}>{item.barcode}</Text>
                      <Text style={styles.historyStatus}>{item.status}</Text>
                    </View>
                    <Text style={styles.historyTitle}>{item.match?.title || item.error || 'Nessuna corrispondenza'}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Storico Importazioni</Text>
              {imports.length === 0 ? (
                <Text style={styles.muted}>Nessuna importazione.</Text>
              ) : (
                imports.map((item) => (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyBarcode}>{item.barcode}</Text>
                      <Text style={styles.historyStatus}>{item.status}</Text>
                    </View>
                    <Text style={styles.historyTitle}>{item.stockx_url}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.errorText}>Solo gli admin possono importare prodotti.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f6f6',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#f0f0f0',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginBottom: 16,
  },
  infoBanner: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  infoText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  cardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginTop: 6,
  },
  muted: {
    color: '#888',
    marginTop: 6,
  },
  errorText: {
    color: '#dc2626',
    marginTop: 8,
  },
  warningText: {
    color: '#b45309',
    marginTop: 4,
    fontSize: 12,
  },
  matchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginBottom: 16,
  },
  matchHeader: {
    marginBottom: 8,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  matchBrand: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  matchImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    marginTop: 10,
  },
  matchLink: {
    color: '#2563eb',
    marginTop: 8,
    fontSize: 12,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  choiceActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  choiceText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  choiceTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  inputHalf: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#000',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  modalText: {
    color: '#444',
    marginTop: 8,
    lineHeight: 18,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  modalButton: {
    flex: 1,
    backgroundColor: '#000',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  modalButtonGhost: {
    flex: 1,
    backgroundColor: '#f2f2f2',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  modalButtonGhostText: {
    color: '#111',
    fontWeight: '700',
  },
  historyItem: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  historyInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyBarcode: {
    fontWeight: '700',
    color: '#000',
  },
  historyStatus: {
    fontWeight: '600',
    color: '#2563eb',
  },
  historyTitle: {
    marginTop: 6,
    color: '#666',
    fontSize: 12,
  },
});

