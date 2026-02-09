import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../src/services/api';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { BarcodeScanner } from '../src/components/BarcodeScanner';
import { safeBack } from '../src/utils/safeBack';

interface Variant {
  title: string;
  sku: string;
  barcode: string;
  price: string;
}

export default function CreateLocalProductScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([{ title: '', sku: '', barcode: '', price: '' }]);
  const [saving, setSaving] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanTarget, setScanTarget] = useState<{ type: 'single' } | { type: 'variant'; index: number } | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const addVariant = () => {
    setVariants([...variants, { title: '', sku: '', barcode: '', price: '' }]);
  };

  const removeVariant = (index: number) => {
    if (variants.length > 1) {
      setVariants(variants.filter((_, i) => i !== index));
    }
  };

  const updateVariant = (index: number, field: keyof Variant, value: string) => {
    const newVariants = [...variants];
    newVariants[index][field] = value;
    setVariants(newVariants);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Errore', 'Inserisci il nome del prodotto');
      return;
    }

    if (!hasVariants && !price.trim()) {
      Alert.alert('Errore', 'Inserisci il prezzo');
      return;
    }

    if (hasVariants) {
      for (let i = 0; i < variants.length; i++) {
        if (!variants[i].title.trim() || !variants[i].price.trim()) {
          Alert.alert('Errore', `Completa la variante ${i + 1} (nome e prezzo obbligatori)`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const productData: any = {
        title: title.trim(),
        description: description.trim() || undefined,
        price: hasVariants ? 0 : parseFloat(price),
        image_base64: image || undefined,
      };

      if (hasVariants) {
        productData.variants = variants.map(v => ({
          title: v.title.trim(),
          sku: v.sku.trim() || undefined,
          barcode: v.barcode.trim() || undefined,
          price: parseFloat(v.price)
        }));
      } else {
        productData.sku = sku.trim() || undefined;
        productData.barcode = barcode.trim() || undefined;
      }

      const result = await api.createLocalProduct(productData);
      if (result?.matched_shopify_product) {
        Alert.alert('Info', 'Il barcode esiste giÃ  su Shopify. UserÃ² il prodotto giÃ  presente.');
      } else {
        Alert.alert('Successo', 'Prodotto creato con successo');
      }
      safeBack(router);
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nella creazione');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => safeBack(router)} style={styles.backButton}>
          <Ionicons name="close" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Nuovo Prodotto Locale</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.backButton}>
          <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
            {saving ? '...' : 'Salva'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Image */}
        <TouchableOpacity style={styles.imageContainer} onPress={pickImage}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="camera" size={40} color="#999" />
              <Text style={styles.imagePlaceholderText}>Aggiungi foto</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Basic Info */}
        <Input
          label="Nome Prodotto *"
          value={title}
          onChangeText={setTitle}
          placeholder="es. Sneakers Custom"
        />

        <Input
          label="Descrizione"
          value={description}
          onChangeText={setDescription}
          placeholder="Descrizione opzionale"
          multiline
        />

        {/* Variants Toggle */}
        <View style={styles.toggleContainer}>
          <Text style={styles.toggleLabel}>Questo prodotto ha taglie/varianti?</Text>
          <TouchableOpacity
            style={[styles.toggle, hasVariants && styles.toggleActive]}
            onPress={() => setHasVariants(!hasVariants)}
          >
            <Text style={[styles.toggleText, hasVariants && styles.toggleTextActive]}>
              {hasVariants ? 'Sì' : 'No'}
            </Text>
          </TouchableOpacity>
        </View>

        {!hasVariants ? (
          <>
            <Input
              label="Prezzo *"
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <View style={styles.variantRow}>
              <View style={styles.variantField}>
                <Input
                  label="SKU"
                  value={sku}
                  onChangeText={setSku}
                  placeholder="Opzionale"
                />
              </View>
              <View style={styles.variantField}>
                <Input
                  label="Barcode"
                  value={barcode}
                  onChangeText={setBarcode}
                  placeholder="Opzionale"
                />
              </View>
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => {
                  setScanTarget({ type: 'single' });
                  setScannerVisible(true);
                }}
              >
                <Ionicons name="barcode-outline" size={20} color="#2563eb" />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.variantsSection}>
            <Text style={styles.sectionTitle}>Varianti</Text>
            
            {variants.map((variant, index) => (
              <View key={index} style={styles.variantCard}>
                <View style={styles.variantHeader}>
                  <Text style={styles.variantTitle}>Variante {index + 1}</Text>
                  {variants.length > 1 && (
                    <TouchableOpacity onPress={() => removeVariant(index)}>
                      <Ionicons name="trash-outline" size={20} color="#dc2626" />
                    </TouchableOpacity>
                  )}
                </View>
                
                <View style={styles.variantRow}>
                  <View style={styles.variantField}>
                    <Input
                      label="Taglia/Nome *"
                      value={variant.title}
                      onChangeText={(v) => updateVariant(index, 'title', v)}
                      placeholder="es. 42, M, L"
                    />
                  </View>
                  <View style={styles.variantField}>
                    <Input
                      label="Prezzo *"
                      value={variant.price}
                      onChangeText={(v) => updateVariant(index, 'price', v)}
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                
                <View style={styles.variantRow}>
                  <View style={styles.variantField}>
                    <Input
                      label="SKU"
                      value={variant.sku}
                      onChangeText={(v) => updateVariant(index, 'sku', v)}
                      placeholder="Opzionale"
                    />
                  </View>
                  <View style={styles.variantField}>
                    <Input
                      label="Barcode"
                      value={variant.barcode}
                      onChangeText={(v) => updateVariant(index, 'barcode', v)}
                      placeholder="Opzionale"
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.scanButton}
                    onPress={() => {
                      setScanTarget({ type: 'variant', index });
                      setScannerVisible(true);
                    }}
                  >
                    <Ionicons name="barcode-outline" size={20} color="#2563eb" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            
            <TouchableOpacity style={styles.addVariantBtn} onPress={addVariant}>
              <Ionicons name="add-circle" size={20} color="#3b82f6" />
              <Text style={styles.addVariantText}>Aggiungi Variante</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#f59e0b" />
          <Text style={styles.infoText}>
            I prodotti locali NON vengono sincronizzati con Shopify. Sono visibili solo in questo gestionale.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <BarcodeScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(code) => {
          if (!scanTarget) return;
          if (scanTarget.type === 'single') {
            setBarcode(code);
          } else {
            updateVariant(scanTarget.index, 'barcode', code);
          }
        }}
        title="Scansiona Barcode"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 50,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3b82f6',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  imageContainer: {
    width: 120,
    height: 120,
    alignSelf: 'center',
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  toggle: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
  },
  toggleActive: {
    backgroundColor: '#22c55e',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  toggleTextActive: {
    color: '#fff',
  },
  variantsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  variantCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  variantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  variantTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  variantRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  variantField: {
    flex: 1,
  },
  scanButton: {
    width: 40,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  addVariantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderStyle: 'dashed',
    gap: 8,
  },
  addVariantText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3b82f6',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginTop: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
});
