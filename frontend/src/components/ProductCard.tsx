import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Platform } from 'react-native';
import { Product, ProductVariant, InventoryLevel } from '../types';

interface ProductCardProps {
  product?: Product;
  variant?: ProductVariant;
  inventory?: InventoryLevel;
  onPress?: () => void;
  showQuantity?: boolean;
  onEditProduct?: () => void;
  onReceive?: () => void;
  onSale?: () => void;
  onMove?: () => void;
  onStall?: () => void;
}

export function ProductCard({
  product,
  variant,
  inventory,
  onPress,
  showQuantity = true,
  onEditProduct,
  onReceive,
  onSale,
  onMove,
  onStall,
}: ProductCardProps) {
  const imageSource = product?.image_base64 || product?.image_url || inventory?.product_image;
  const title = product?.title || inventory?.product_title || 'Prodotto';
  const variantTitle = variant?.title || inventory?.variant_title;
  const barcode = variant?.barcode || inventory?.variant_barcode;
  const quantity = inventory?.quantity;
  const showActions = Boolean(onEditProduct || onReceive || onSale || onMove || onStall);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.topRow} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.imageContainer}>
          {imageSource ? (
            <Image
              source={{ uri: imageSource }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>IMG</Text>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {variantTitle && <Text style={styles.variant}>{variantTitle}</Text>}
          {barcode && <Text style={styles.barcode}>{barcode}</Text>}
          {inventory?.location_name && (
            <Text style={styles.location}>
              {inventory.location_name}{inventory.shelf_name ? ` / ${inventory.shelf_name}` : ''}
            </Text>
          )}
        </View>
        {showQuantity && quantity !== undefined && (
          <View style={styles.quantityContainer}>
            <Text style={styles.quantity}>{quantity}</Text>
            <Text style={styles.quantityLabel}>pz</Text>
          </View>
        )}
      </TouchableOpacity>
      {showActions && (
        <View style={styles.actions}>
          {onEditProduct && (
            <TouchableOpacity style={styles.actionBtn} onPress={onEditProduct}>
              <Text style={styles.actionText}>Modifica</Text>
            </TouchableOpacity>
          )}
          {onReceive && (
            <TouchableOpacity style={styles.actionBtn} onPress={onReceive}>
              <Text style={styles.actionText}>Ricevi</Text>
            </TouchableOpacity>
          )}
          {onSale && (
            <TouchableOpacity style={styles.actionBtn} onPress={onSale}>
              <Text style={styles.actionText}>Vendita</Text>
            </TouchableOpacity>
          )}
          {onMove && (
            <TouchableOpacity style={styles.actionBtn} onPress={onMove}>
              <Text style={styles.actionText}>Sposta</Text>
            </TouchableOpacity>
          )}
          {onStall && (
            <TouchableOpacity style={styles.actionBtn} onPress={onStall}>
              <Text style={styles.actionText}>Stallo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  topRow: {
    flexDirection: 'row',
  },
  imageContainer: {
    width: 60,
    height: 60,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#999',
    fontSize: 12,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  variant: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  barcode: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  location: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  quantityContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 12,
  },
  quantity: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  quantityLabel: {
    fontSize: 11,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  actionText: {
    fontSize: 12,
    color: '#111',
    fontWeight: '600',
  },
});
