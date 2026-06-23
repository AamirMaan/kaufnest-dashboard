export interface EbayCategory {
  label: string;
  fvfRate: number;
  flatFee: number;
}

export interface AmazonCategory {
  label: string;
  referralFeeRate: number;
}

export const EBAY_CATEGORIES: EbayCategory[] = [
  { label: "Most categories",              fvfRate: 0.128, flatFee: 0.30 },
  { label: "Clothes, Shoes & Accessories", fvfRate: 0.130, flatFee: 0.30 },
  { label: "Books, Comics & Magazines",    fvfRate: 0.146, flatFee: 0.30 },
  { label: "Music",                        fvfRate: 0.146, flatFee: 0.30 },
  { label: "DVDs & Films",                 fvfRate: 0.146, flatFee: 0.30 },
  { label: "Vehicle Parts & Accessories",  fvfRate: 0.090, flatFee: 0.30 },
  { label: "Motors",                       fvfRate: 0.020, flatFee: 0.30 },
];

export const AMAZON_CATEGORIES: AmazonCategory[] = [
  { label: "Baby Products",           referralFeeRate: 0.08 },
  { label: "Books",                   referralFeeRate: 0.15 },
  { label: "Camera & Photo",          referralFeeRate: 0.08 },
  { label: "Clothing & Accessories",  referralFeeRate: 0.17 },
  { label: "Consumer Electronics",    referralFeeRate: 0.08 },
  { label: "Electronics Accessories", referralFeeRate: 0.15 },
  { label: "Garden & Outdoors",       referralFeeRate: 0.15 },
  { label: "Health & Beauty",         referralFeeRate: 0.08 },
  { label: "Home & Kitchen",          referralFeeRate: 0.15 },
  { label: "Musical Instruments",     referralFeeRate: 0.12 },
  { label: "Office Products",         referralFeeRate: 0.15 },
  { label: "Pet Supplies",            referralFeeRate: 0.15 },
  { label: "Shoes & Handbags",        referralFeeRate: 0.17 },
  { label: "Sports & Outdoors",       referralFeeRate: 0.15 },
  { label: "Toys & Games",            referralFeeRate: 0.15 },
  { label: "Video Games",             referralFeeRate: 0.15 },
];
