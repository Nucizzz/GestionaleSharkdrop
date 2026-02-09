import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { Product, ProductVariant, Location } from '../src/types';
import { safeBack } from '../src/utils/safeBack';

export default function ProductDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [variantStock, setVariantStock] = useState<Record<string, number>>({});

  // Edit modals
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [showEditVariantModal, setShowEditVariantModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  
  // Receive modal
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveVariant, setReceiveVariant] = useState<ProductVariant | null>(null);
  const [receiveQuantity, setReceiveQuantity] = useState('1');
  const [receiveLocationId, setReceiveLocationId] = useState('');

  // Form states
  const [productTitle, setProductTitle] = useState('');
  const [variantTitle, setVariantTitle] = useState('');
  const [variantSku, setVariantSku] = useState('');
  const [variantBarcode, setVariantBarcode] = useState('');
  const [variantPrice, setVariantPrice] = useState('');

  const loadProduct = async () => {
    if (!params.id) return;
    try {
      const [data, locs, inventory] = await Promise.all([
        api.getProduct(params.id),
        api.getLocations(),
        api.getInventorySummary().catch(() => []),
      ]);
      setProduct(data);
      setProductTitle(data.title);
      setLocations(locs);
      if (Array.isArray(inventory)) {
        const stockMap: Record<string, number> = {};
        for (const item of inventory) {
          const vid = item.variant_id;
          if (!vid) continue;
          stockMap[vid] = (stockMap[vid] || 0) + (item.quantity || 0);
        }
        setVariantStock(stockMap);
      }
      if (locs.length > 0) {
        setReceiveLocationId(locs[0].id);
      }
    } catch (error) {
      console.error('Error loading product:', error);
      Alert.alert('Errore', 'Prodotto non trovato');
      safeBack(router);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProduct();
  }, [params.id]);

  const saveProduct = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await api.updateProduct(product.id, { title: productTitle });
      setShowEditProductModal(false);
      loadProduct();
      Alert.alert('Successo', 'Prodotto aggiornato');
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const openVariantEdit = (variant: ProductVariant) => {
    setEditingVariant(variant);
    setVariantTitle(variant.title);
    setVariantSku(variant.sku || '');
    setVariantBarcode(variant.barcode || '');
    setVariantPrice(variant.price?.toString() || '');
    setShowEditVariantModal(true);
  };

  const saveVariant = async () => {
    if (!product || !editingVariant) return;
    setSaving(true);
    try {
      await api.updateVariant(product.id, editingVariant.id, {
        title: variantTitle,
        sku: variantSku || undefined,
        barcode: variantBarcode || undefined,
        price: variantPrice ? parseFloat(variantPrice) : undefined,
      });
      setShowEditVariantModal(false);
      loadProduct();
      Alert.alert('Successo', 'Variante aggiornata');
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async () => {
    if (!product) return;
    Alert.alert(
      'Elimina Prodotto',
      `Sei sicuro di voler eliminare "${product.title}"?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteProduct(product.id);
              safeBack(router);
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore eliminazione');
            }
          },
        },
      ]
    );
  };

  const openReceiveModal = (variant: ProductVariant) => {
    if (locations.length === 0) {
      Alert.alert('Errore', 'Devi prima creare una Location in Impostazioni → Gestione Location');
      return;
    }
    setReceiveVariant(variant);
    setReceiveQuantity('1');
    setShowReceiveModal(true);
  };

  const handleReceive = async () => {
    if (!product || !receiveVariant || !receiveLocationId) return;
    
    const qty = parseInt(receiveQuantity);
    if (!qty || qty <= 0) {
      Alert.alert('Errore', 'Inserisci una quantità valida');
      return;
    }

    setSaving(true);
    try {
      const result = await api.receiveInventory({
        variant_id: receiveVariant.id,
        location_id: receiveLocationId,
        quantity: qty
      });
      
      setShowReceiveModal(false);
      Alert.alert(
        'Successo', 
        `${qty}x ${product.title} (${receiveVariant.title}) aggiunto all'inventario` + 
        (result.shopify_updated ? '\n✓ Aggiornato anche su Shopify' : '')
      );
      loadProduct();
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nella ricezione');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !product) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento...</Text>
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
        <Text style={styles.title} numberOfLines={1}>Dettagli Prodotto</Text>
        {isAdmin && (
          <TouchableOpacity onPress={() => setShowEditProductModal(true)} style={styles.editButton}>
            <Ionicons name="pencil" size={22} color="#2563eb" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Product Image */}
        <View style={styles.imageContainer}>
          {product.image_base64 || product.image_url ? (
            <Image
              source={{ uri: product.image_base64 || product.image_url }}
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={64} color="#ccc" />
            </View>
          )}
        </View>

        {/* Product Info */}
        <View style={styles.infoCard}>
          <Text style={styles.productTitle}>{product.title}</Text>
          {product.shopify_product_id && (
            <Text style={styles.shopifyId}>Shopify ID: {product.shopify_product_id}</Text>
          )}
        </View>

        {/* Variants */}
        <Text style={styles.sectionTitle}>Varianti ({product.variants?.length || 0})</Text>
        
        {product.variants?.map((variant) => (
          <TouchableOpacity
            key={variant.id}
            style={styles.variantCard}
            onPress={() => isAdmin && openVariantEdit(variant)}
            disabled={!isAdmin}
          >
            <View style={styles.variantInfo}>
              <View style={styles.variantTitleRow}>
                <Text style={styles.variantTitle}>{variant.title}</Text>
                <View style={[styles.stockBadge, (variantStock[variant.id] || 0) > 0 ? styles.stockBadgeOk : styles.stockBadgeEmpty]}>
                  <Text style={styles.stockBadgeText}>
                    {(variantStock[variant.id] || 0) > 0 ? `Disponibile: ${variantStock[variant.id]}` : 'Non disponibile'}
                  </Text>
                </View>
              </View>
              <View style={styles.variantDetails}>
                {variant.barcode && (
                  <View style={styles.detailRow}>
                    <Ionicons name="barcode-outline" size={14} color="#666" />
                    <Text style={styles.detailText}>{variant.barcode}</Text>
                  </View>
                )}
                {variant.upc_backup && variant.upc_backup !== variant.barcode && (
                  <View style={styles.detailRow}>
                    <Ionicons name="barcode-outline" size={14} color="#666" />
                    <Text style={styles.detailText}>UPC backup: {variant.upc_backup}</Text>
                  </View>
                )}
                {variant.sku && (
                  <View style={styles.detailRow}>
                    <Ionicons name="pricetag-outline" size={14} color="#666" />
                    <Text style={styles.detailText}>SKU: {variant.sku}</Text>
                  </View>
                )}
                {variant.price !== undefined && variant.price !== null && (
                  <View style={styles.detailRow}>
                    <Ionicons name="cash-outline" size={14} color="#666" />
                    <Text style={styles.detailText}>€{variant.price.toFixed(2)}</Text>
                  </View>
                )}
              </View>
            </View>
            {isAdmin && (
              <Ionicons name="chevron-forward" size={20} color="#ccc" />
            )}
          </TouchableOpacity>
        ))}

        {/* Delete Button */}
        {isAdmin && (
          <Button
            title="Elimina Prodotto"
            onPress={deleteProduct}
            variant="danger"
            style={{ marginTop: 24 }}
          />
        )}
      </ScrollView>

      {/* Edit Product Modal */}
      <Modal
        visible={showEditProductModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditProductModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditProductModal(false)}>
              <Text style={styles.modalCancel}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Modifica Prodotto</Text>
            <TouchableOpacity onPress={saveProduct} disabled={saving}>
              <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>Salva</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            <Input
              label="Titolo"
              value={productTitle}
              onChangeText={setProductTitle}
              placeholder="Nome prodotto"
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Edit Variant Modal */}
      <Modal
        visible={showEditVariantModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditVariantModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditVariantModal(false)}>
              <Text style={styles.modalCancel}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Modifica Variante</Text>
            <TouchableOpacity onPress={saveVariant} disabled={saving}>
              <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>Salva</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            <Input
              label="Taglia/Variante"
              value={variantTitle}
              onChangeText={setVariantTitle}
              placeholder="es. M, L, XL"
            />
            <Input
              label="SKU"
              value={variantSku}
              onChangeText={setVariantSku}
              placeholder="Codice SKU"
              autoCapitalize="characters"
            />
            <Input
              label="Barcode"
              value={variantBarcode}
              onChangeText={setVariantBarcode}
              placeholder="Codice a barre"
            />
            <Input
              label="Prezzo (€)"
              value={variantPrice}
              onChangeText={setVariantPrice}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </ScrollView>
        </View>
      </Modal>
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
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  editButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  imageContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  productTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  shopifyId: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  variantCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  variantInfo: {
    flex: 1,
  },
  variantTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  variantTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  variantDetails: {
    marginTop: 8,
    gap: 4,
  },
  stockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  stockBadgeOk: {
    backgroundColor: '#ecfdf3',
    borderColor: '#16a34a',
  },
  stockBadgeEmpty: {
    backgroundColor: '#fef2f2',
    borderColor: '#dc2626',
  },
  stockBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  modalCancel: {
    fontSize: 16,
    color: '#666',
  },
  modalSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
});
