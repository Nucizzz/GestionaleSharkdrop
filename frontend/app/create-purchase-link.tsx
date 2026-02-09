import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, TextInput, Modal, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, getPublicWebBaseUrl } from '../src/services/api';
import { Button } from '../src/components/Button';
import * as Clipboard from 'expo-clipboard';
import { safeBack } from '../src/utils/safeBack';

interface Product {
  id: string;
  title: string;
  image_url?: string;
  image_base64?: string;
  variants: {
    id: string;
    title: string;
    price?: number;
  }[];
}

interface Location {
  id: string;
  name: string;
}

interface InventoryItem {
  id: string;
  product_id?: string;
  variant_id?: string;
  quantity: number;
  product_title?: string;
  variant_title?: string;
  product_image?: string;
  location_id?: string;
  location_name?: string;
}

interface SelectedItem {
  product_id?: string;
  variant_id?: string;
  title: string;
  variant_title?: string;
  quantity: number;
  purchase_price: number;
  image_base64?: string;
}

export default function CreatePurchaseLinkScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [step, setStep] = useState<'select' | 'prices' | 'done'>('select');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [note, setNote] = useState('');
  const [docType, setDocType] = useState<'acquisto' | 'contovendita'>('acquisto');
  const [sourceMode, setSourceMode] = useState<'catalogo' | 'inventario'>('catalogo');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdLink, setCreatedLink] = useState<{ token: string; total: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQty, setManualQty] = useState('1');

  const pageSize = 60;

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getProducts(undefined, pageSize, 0);
      const batch = data.products || [];
      setProducts(batch);
      setTotalProducts(data.total || 0);
      setOffset(batch.length);
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    const run = async () => {
      try {
        const data = await api.getLocations();
        setLocations(data || []);
      } catch (error) {
        console.error('Error loading locations:', error);
      }
    };
    run();
  }, []);

  const loadInventory = useCallback(async (locId?: string) => {
    try {
      setInventoryLoading(true);
      const data = await api.getInventorySummary(locId || undefined);
      setInventoryItems(data || []);
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sourceMode === 'inventario') {
      loadInventory(locationId || undefined);
    }
  }, [sourceMode, locationId, loadInventory]);

  useEffect(() => {
    const q = searchQuery.trim();
    const run = async () => {
      if (!q) {
        if (products.length > 0) return;
        await loadProducts();
        return;
      }
      try {
        const data = await api.getProducts(q, pageSize, 0);
        const batch = data.products || [];
        setProducts(batch);
        setTotalProducts(data.total || 0);
        setOffset(batch.length);
      } catch (error) {
        console.error('Error searching products:', error);
      }
    };

    const handle = setTimeout(run, 300);
    return () => clearTimeout(handle);
  }, [searchQuery, loadProducts, pageSize, products.length]);

  const handleLoadMore = async () => {
    if (loadingMore || searchQuery.trim()) return;
    if (products.length >= totalProducts) return;
    setLoadingMore(true);
    try {
      const data = await api.getProducts(undefined, pageSize, offset);
      const batch = data.products || [];
      setProducts((prev) => [...prev, ...batch]);
      setTotalProducts(data.total || totalProducts);
      setOffset((prev) => prev + batch.length);
    } catch (error) {
      console.error('Error loading more products:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    const tokens = q.split(/\s+/).filter(Boolean);
    return products.filter(p => {
      const variantNames = p.variants.map(v => v.title).join(' ');
      const hay = `${p.title} ${variantNames}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [products, searchQuery]);

  const filteredInventory = useMemo(() => {
    const q = inventoryQuery.trim().toLowerCase();
    if (!q) return inventoryItems;
    const tokens = q.split(/\s+/).filter(Boolean);
    return inventoryItems.filter((inv) => {
      const hay = `${inv.product_title || ''} ${inv.variant_title || ''} ${inv.location_name || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [inventoryItems, inventoryQuery]);

  const toggleProduct = (product: Product, variant?: { id: string; title: string; price?: number }) => {
    setSelectedItems((prev) => {
      const existing = prev.find((item) =>
        variant
          ? item.product_id === product.id && item.variant_id === variant.id
          : item.product_id === product.id && !item.variant_id
      );

      if (existing) {
        return prev.filter((item) =>
          !(item.product_id === existing.product_id && item.variant_id === existing.variant_id)
        );
      }

      return [
        ...prev,
        {
          product_id: product.id,
          variant_id: variant?.id,
          title: product.title,
          variant_title: variant?.title,
          quantity: 1,
          purchase_price: variant?.price || 0,
          image_base64: product.image_base64,
        },
      ];
    });
  };

  const toggleInventoryItem = (inv: InventoryItem) => {
    if (!inv.product_id) return;
    setSelectedItems((prev) => {
      const existing = prev.find((item) =>
        item.product_id === inv.product_id && item.variant_id === inv.variant_id
      );
      if (existing) {
        return prev.filter((item) =>
          !(item.product_id === existing.product_id && item.variant_id === existing.variant_id)
        );
      }
      return [
        ...prev,
        {
          product_id: inv.product_id,
          variant_id: inv.variant_id,
          title: inv.product_title || 'Prodotto',
          variant_title: inv.variant_title,
          quantity: 1,
          purchase_price: 0,
          image_base64: inv.product_image,
        },
      ];
    });
  };

  const isSelected = (productId: string, variantId?: string) => {
    return selectedItems.some(item => 
      item.product_id === productId && item.variant_id === variantId
    );
  };

  const renderProduct = useCallback(({ item: product }: { item: Product }) => (
    <View style={styles.productCard}>
      <View style={styles.productHeader}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={styles.productImage} />
        ) : (
          <View style={[styles.productImage, styles.imagePlaceholder]}>
            <Ionicons name="cube-outline" size={24} color="#999" />
          </View>
        )}
        <Text style={styles.productTitle} numberOfLines={2}>{product.title}</Text>
      </View>

      {product.variants.length > 1 ? (
        <View style={styles.variantsGrid}>
          {product.variants.map((variant) => (
            <TouchableOpacity
              key={variant.id}
              style={[
                styles.variantChip,
                isSelected(product.id, variant.id) && styles.variantChipSelected
              ]}
              onPress={() => toggleProduct(product, variant)}
            >
              <Text style={[
                styles.variantChipText,
                isSelected(product.id, variant.id) && styles.variantChipTextSelected
              ]}>
                {variant.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.selectButton,
            isSelected(product.id) && styles.selectButtonSelected
          ]}
          onPress={() => toggleProduct(product)}
        >
          <Ionicons 
            name={isSelected(product.id) ? "checkmark-circle" : "add-circle-outline"} 
            size={20} 
            color={isSelected(product.id) ? "#fff" : "#3b82f6"} 
          />
          <Text style={[
            styles.selectButtonText,
            isSelected(product.id) && styles.selectButtonTextSelected
          ]}>
            {isSelected(product.id) ? 'Selezionato' : 'Seleziona'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ), [isSelected, toggleProduct]);

  const renderInventoryItem = useCallback(({ item: inv }: { item: InventoryItem }) => (
    <View style={styles.productCard}>
      <View style={styles.productHeader}>
        {inv.product_image ? (
          <Image source={{ uri: inv.product_image }} style={styles.productImage} />
        ) : (
          <View style={[styles.productImage, styles.imagePlaceholder]}>
            <Ionicons name="cube-outline" size={24} color="#999" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.productTitle} numberOfLines={2}>{inv.product_title || 'Prodotto'}</Text>
          {inv.variant_title ? <Text style={styles.inventoryMeta}>{inv.variant_title}</Text> : null}
          <View style={styles.inventoryMetaRow}>
            <Text style={styles.inventoryMeta}>Qta: {inv.quantity}</Text>
            {inv.location_name ? <Text style={styles.inventoryMeta}>- {inv.location_name}</Text> : null}
          </View>
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.selectButton,
          isSelected(inv.product_id || '', inv.variant_id) && styles.selectButtonSelected
        ]}
        onPress={() => toggleInventoryItem(inv)}
      >
        <Ionicons
          name={isSelected(inv.product_id || '', inv.variant_id) ? "checkmark-circle" : "add-circle-outline"}
          size={20}
          color={isSelected(inv.product_id || '', inv.variant_id) ? "#fff" : "#3b82f6"}
        />
        <Text style={[
          styles.selectButtonText,
          isSelected(inv.product_id || '', inv.variant_id) && styles.selectButtonTextSelected
        ]}>
          {isSelected(inv.product_id || '', inv.variant_id) ? 'Selezionato' : 'Seleziona'}
        </Text>
      </TouchableOpacity>
    </View>
  ), [isSelected, toggleInventoryItem]);

  const updateItemPrice = (index: number, price: string) => {
    setSelectedItems((prev) => {
      const next = [...prev];
      next[index].purchase_price = parseFloat(price) || 0;
      return next;
    });
  };

  const updateItemQuantity = (index: number, quantity: string) => {
    setSelectedItems((prev) => {
      const next = [...prev];
      next[index].quantity = parseInt(quantity) || 1;
      return next;
    });
  };

  const removeItem = (index: number) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addManualItem = () => {
    if (!manualName.trim()) {
      Alert.alert('Errore', 'Inserisci nome prodotto');
      return;
    }
    const price = parseFloat(manualPrice);
    if (docType === 'acquisto') {
      if (isNaN(price) || price <= 0) {
        Alert.alert('Errore', 'Inserisci un prezzo valido');
        return;
      }
    }
    const qty = parseInt(manualQty) || 1;
    const normalizedPrice = isNaN(price) ? 0 : price;
    setSelectedItems([
      ...selectedItems,
      {
        product_id: undefined,
        title: manualName.trim(),
        variant_title: 'Manuale',
        quantity: qty,
        purchase_price: docType === 'acquisto' ? price : normalizedPrice,
      },
    ]);
    setManualName('');
    setManualPrice('');
    setManualQty('1');
    setShowManualModal(false);
  };

  const getTotal = () => {
    if (docType === 'contovendita') return 0;
    return selectedItems.reduce((sum, item) => sum + (item.purchase_price * item.quantity), 0);
  };

  const handleCreateLink = async () => {
    if (selectedItems.length === 0) {
      Alert.alert('Errore', 'Seleziona almeno un prodotto');
      return;
    }

    if (docType === 'acquisto') {
      for (let item of selectedItems) {
        if (item.purchase_price <= 0) {
          Alert.alert('Errore', `Inserisci un prezzo valido per ${item.title}`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const result = await api.createPurchaseLink(selectedItems, note || undefined, docType);
      setCreatedLink({ token: result.token, total: result.total_amount });
      setStep('done');
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nella creazione');
    } finally {
      setSaving(false);
    }
  };

  const getPublicUrl = () => {
    if (!createdLink?.token) return '';
    const base = getPublicWebBaseUrl();
    return `${base}/acquisto/${createdLink.token}`;
  };

  const copyLink = async () => {
    if (createdLink) {
      const publicUrl = getPublicUrl();
      if (!publicUrl) {
        Alert.alert('Errore', 'URL pubblico non configurato. Imposta EXPO_PUBLIC_WEB_URL.');
        return;
      }
      await Clipboard.setStringAsync(publicUrl);
      Alert.alert('Copiato!', 'Link copiato negli appunti');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento prodotti...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => safeBack(router)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>
          {step === 'select' ? 'Seleziona Prodotti' : step === 'prices' ? 'Imposta Prezzi' : 'Link Creato!'}
        </Text>
        {step === 'select' ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowManualModal(true)}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.backButton} />
        )}
      </View>

      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        <View style={[styles.step, step !== 'done' && styles.stepActive]}>
          <Text style={styles.stepNumber}>1</Text>
        </View>
        <View style={styles.stepLine} />
        <View style={[styles.step, (step === 'prices' || step === 'done') && styles.stepActive]}>
          <Text style={styles.stepNumber}>2</Text>
        </View>
        <View style={styles.stepLine} />
        <View style={[styles.step, step === 'done' && styles.stepActive]}>
          <Text style={styles.stepNumber}>3</Text>
        </View>
      </View>

      {step === 'select' && (
        <>
          <View style={styles.docTypeCard}>
            <Text style={styles.docTypeLabel}>Tipo documento</Text>
            <View style={styles.docTypeRow}>
              <TouchableOpacity
                style={[styles.docTypeOption, docType === 'acquisto' && styles.docTypeOptionActive]}
                onPress={() => setDocType('acquisto')}
              >
                <Text style={[styles.docTypeText, docType === 'acquisto' && styles.docTypeTextActive]}>Acquisto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.docTypeOption, docType === 'contovendita' && styles.docTypeOptionActive]}
                onPress={() => setDocType('contovendita')}
              >
                <Text style={[styles.docTypeText, docType === 'contovendita' && styles.docTypeTextActive]}>Contovendita</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.docTypeCard}>
            <Text style={styles.docTypeLabel}>Fonte prodotti</Text>
            <View style={styles.docTypeRow}>
              <TouchableOpacity
                style={[styles.docTypeOption, sourceMode === 'catalogo' && styles.docTypeOptionActive]}
                onPress={() => setSourceMode('catalogo')}
              >
                <Text style={[styles.docTypeText, sourceMode === 'catalogo' && styles.docTypeTextActive]}>Catalogo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.docTypeOption, sourceMode === 'inventario' && styles.docTypeOptionActive]}
                onPress={() => setSourceMode('inventario')}
              >
                <Text style={[styles.docTypeText, sourceMode === 'inventario' && styles.docTypeTextActive]}>Inventario</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Search */}
          {sourceMode === 'inventario' ? (
            <>
              <Text style={styles.locationLabel}>Filtro location</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationRow}>
                <TouchableOpacity
                  style={[styles.locationChip, !locationId && styles.locationChipActive]}
                  onPress={() => setLocationId('')}
                >
                  <Text style={[styles.locationChipText, !locationId && styles.locationChipTextActive]}>Tutte</Text>
                </TouchableOpacity>
                {locations.map((loc) => (
                  <TouchableOpacity
                    key={loc.id}
                    style={[styles.locationChip, locationId === loc.id && styles.locationChipActive]}
                    onPress={() => setLocationId(loc.id)}
                  >
                    <Text style={[styles.locationChipText, locationId === loc.id && styles.locationChipTextActive]}>
                      {loc.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color="#999" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Cerca in inventario..."
                  value={inventoryQuery}
                  onChangeText={setInventoryQuery}
                />
              </View>
            </>
          ) : (
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#999" />
              <TextInput
                style={styles.searchInput}
                placeholder="Cerca prodotti..."
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          )}

          <Modal
            visible={showManualModal}
            animationType="slide"
            transparent
            onRequestClose={() => setShowManualModal(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Aggiungi prodotto a mano</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Nome prodotto"
                  value={manualName}
                  onChangeText={setManualName}
                />
                <View style={styles.modalRow}>
                  <TextInput
                    style={styles.modalInput}
                    placeholder={docType === 'contovendita' ? 'Prezzo (opzionale)' : 'Prezzo'}
                    value={manualPrice}
                    onChangeText={setManualPrice}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Qta"
                    value={manualQty}
                    onChangeText={setManualQty}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.modalActions}>
                  <TouchableOpacity onPress={() => setShowManualModal(false)} style={styles.modalCancel}>
                    <Text style={styles.modalCancelText}>Annulla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={addManualItem} style={styles.modalAdd}>
                    <Text style={styles.modalAddText}>Aggiungi</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Products List */}
          {sourceMode === 'catalogo' ? (
            <FlatList
              style={styles.content}
              contentContainerStyle={styles.listContent}
              data={filteredProducts}
              keyExtractor={(item) => item.id}
              renderItem={renderProduct}
              initialNumToRender={12}
              windowSize={7}
              removeClippedSubviews={false}
              ListFooterComponent={
                <>
                  {!searchQuery.trim() && products.length < totalProducts && (
                    <View style={styles.loadMoreBox}>
                      <Button
                        title={loadingMore ? 'Caricamento...' : 'Carica altri'}
                        onPress={handleLoadMore}
                        loading={loadingMore}
                      />
                      <Text style={styles.loadMoreHint}>
                        {products.length} / {totalProducts} prodotti
                      </Text>
                    </View>
                  )}
                </>
              }
            />
          ) : (
            <FlatList
              style={styles.content}
              contentContainerStyle={styles.listContent}
              data={filteredInventory}
              keyExtractor={(item) => item.id}
              renderItem={renderInventoryItem}
              initialNumToRender={12}
              windowSize={7}
              removeClippedSubviews={false}
              ListFooterComponent={
                <>
                  {inventoryLoading && (
                    <View style={styles.loadMoreBox}>
                      <Text style={styles.loadMoreHint}>Caricamento inventario...</Text>
                    </View>
                  )}
                </>
              }
            />
          )}

          {/* Bottom Bar */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.selectedCount}>{selectedItems.length} prodotti selezionati</Text>
            <Button
              title="Continua"
              onPress={() => setStep('prices')}
              disabled={selectedItems.length === 0}
            />
          </View>
        </>
      )}

      {step === 'prices' && (
        <>
          <ScrollView style={styles.content}>
            {selectedItems.map((item, index) => (
              <View key={index} style={styles.priceCard}>
                <View style={styles.priceCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.priceCardTitle}>{item.title}</Text>
                    {item.variant_title && (
                      <Text style={styles.priceCardVariant}>{item.variant_title}</Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => removeItem(index)}>
                    <Ionicons name="close-circle" size={24} color="#dc2626" />
                  </TouchableOpacity>
                </View>

                <View style={styles.priceRow}>
                  <View style={styles.priceField}>
                    <Text style={styles.priceLabel}>Quantita</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={String(item.quantity)}
                      onChangeText={(v) => updateItemQuantity(index, v)}
                      keyboardType="number-pad"
                    />
                  </View>
                  {docType === 'acquisto' ? (
                    <>
                      <View style={styles.priceField}>
                        <Text style={styles.priceLabel}>Prezzo Acquisto</Text>
                        <TextInput
                          style={styles.priceInput}
                          value={item.purchase_price > 0 ? String(item.purchase_price) : ''}
                          onChangeText={(v) => updateItemPrice(index, v)}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                        />
                      </View>
                      <View style={styles.subtotalField}>
                        <Text style={styles.priceLabel}>Subtotale</Text>
                        <Text style={styles.subtotalValue}>EUR {(item.purchase_price * item.quantity).toFixed(2)}</Text>
                      </View>
                    </>
                  ) : (
                    <View style={styles.priceField}>
                      <Text style={styles.priceLabel}>Prezzo Suggerito (opzionale)</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={item.purchase_price > 0 ? String(item.purchase_price) : ''}
                        onChangeText={(v) => updateItemPrice(index, v)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                      />
                    </View>
                  )}
                </View>
              </View>
            ))}

            {/* Note */}
            <View style={styles.noteContainer}>
              <Text style={styles.noteLabel}>Note (opzionale)</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Aggiungi note per il fornitore..."
                multiline
              />
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* Bottom Bar */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
            <View>
              <Text style={styles.totalLabel}>Totale</Text>
              {docType === 'acquisto' ? (
                <Text style={styles.totalValue}>EUR {getTotal().toFixed(2)}</Text>
              ) : (
                <Text style={styles.totalValue}>n/a</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="Indietro" onPress={() => setStep('select')} variant="outline" />
              <Button title="Crea Link" onPress={handleCreateLink} loading={saving} />
            </View>
          </View>
        </>
      )}

      {step === 'done' && createdLink && (
        <View style={styles.doneContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
          </View>
          
          <Text style={styles.doneTitle}>Link Creato!</Text>
          <Text style={styles.doneSubtitle}>
            {docType === 'acquisto' ? `Totale: EUR ${createdLink.total.toFixed(2)}` : 'Totale: n/a'}
          </Text>
          
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={2}>{getPublicUrl()}</Text>
          </View>
          
          <View style={styles.doneActions}>
            <Button title="Copia Link" onPress={copyLink} />
            <Button 
              title="Condividi" 
              onPress={() => {
                // Share functionality
                Alert.alert('Condividi', `Invia questo link al fornitore:\n\n${getPublicUrl()}`);
              }}
              variant="outline"
            />
          </View>
          
          <View style={styles.infoBox}>
            <Ionicons name="time-outline" size={20} color="#f59e0b" />
            <Text style={styles.infoText}>
              Il link scadra' tra 2 giorni. Il proprietario dovra' compilare i suoi dati per completare il documento.
            </Text>
          </View>
          
          <TouchableOpacity style={styles.backLink} onPress={() => router.push('/purchases')}>
            <Text style={styles.backLinkText}>Vai agli Acquisti -></Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 40,
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
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 16,
    gap: 8,
  },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepActive: {
    backgroundColor: '#3b82f6',
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: '#e0e0e0',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 8,
  },
  locationLabel: {
    marginTop: 8,
    marginHorizontal: 16,
    fontSize: 12,
    fontWeight: '600',
    color: '#111',
  },
  locationRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 10,
    alignItems: 'center',
  },
  locationChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minHeight: 40,
  },
  locationChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  locationChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  locationChipTextActive: {
    color: '#fff',
  },
  docTypeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  docTypeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
    marginBottom: 8,
  },
  docTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  docTypeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f2f2f2',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  docTypeOptionActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  docTypeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
  },
  docTypeTextActive: {
    color: '#fff',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#111',
  },
  modalRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  modalCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: '#666',
    fontWeight: '600',
  },
  modalAdd: {
    backgroundColor: '#000',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalAddText: {
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 140,
  },
  productCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  productImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  imagePlaceholder: {
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  inventoryMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  inventoryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  variantsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  loadMoreBox: {
    marginTop: 12,
    alignItems: 'center',
    gap: 8,
  },
  loadMoreHint: {
    fontSize: 12,
    color: '#666',
  },
  variantChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  variantChipSelected: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  variantChipText: {
    fontSize: 12,
    color: '#333',
  },
  variantChipTextSelected: {
    color: '#fff',
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    gap: 6,
  },
  selectButtonSelected: {
    backgroundColor: '#3b82f6',
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3b82f6',
  },
  selectButtonTextSelected: {
    color: '#fff',
  },
  bottomBar: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedCount: {
    fontSize: 14,
    color: '#666',
  },
  priceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  priceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  priceCardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  priceCardVariant: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  priceField: {
    flex: 1,
  },
  priceLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  priceInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  subtotalField: {
    flex: 1,
    alignItems: 'flex-end',
  },
  subtotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22c55e',
  },
  noteContainer: {
    marginTop: 16,
  },
  noteLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  noteInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    minHeight: 80,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlignVertical: 'top',
  },
  totalLabel: {
    fontSize: 12,
    color: '#666',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#22c55e',
  },
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  successIcon: {
    marginBottom: 24,
  },
  doneTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  doneSubtitle: {
    fontSize: 18,
    color: '#22c55e',
    fontWeight: '600',
    marginBottom: 24,
  },
  linkBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  linkText: {
    fontSize: 14,
    color: '#3b82f6',
    textAlign: 'center',
  },
  doneActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    width: '100%',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  backLink: {
    marginTop: 24,
    padding: 12,
  },
  backLinkText: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '500',
  },
});






