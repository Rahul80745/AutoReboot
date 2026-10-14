// Default definition of the "Sell your vehicle" form. Stored in the form_fields table on first start;
// after that the owner edits it from the owner console (Sell form tab).
// type: subtype | brand | text | number | select | textarea | tyres | state | toggle | checks | photos | color
// group: vehicle | details | media | pricing
export const GROUPS = ['vehicle', 'details', 'media', 'pricing'];
export const CUSTOM_TYPES = ['text', 'number', 'select', 'textarea', 'toggle'];
export const REQUIRABLE = ['text', 'number', 'select', 'textarea', 'tyres', 'photos', 'checks'];

const HIGHLIGHTS = ['Excellent Running Condition', 'Regularly Serviced', 'New Tyres', 'Heavy Body with Strong Cabin', 'Tipper Body in Good Condition', 'Ready to Work – No Work Required', 'Insurance Valid', 'Fitness Certificate Valid', 'National Permit', 'Loan Available', 'Single Owner', 'Accident Free'];

// [key, label, type, group, {locked, required, options, placeholder}]
const F = (key, label, type, group, o = {}) => ({ key, label, type, group, locked: !!o.locked, required: !!(o.locked || o.required), options: o.options || [], placeholder: o.placeholder || '' });

export const DEFAULT_FIELDS = [
  F('subtype', 'Truck type', 'subtype', 'vehicle', { locked: true }),
  F('brand', 'Brand', 'brand', 'vehicle', { locked: true }),
  F('model', 'Model number', 'text', 'vehicle', { locked: true }),
  F('title', 'Ad title', 'text', 'vehicle', { required: true }),
  F('year', 'Model year', 'number', 'details', { locked: true }),
  F('km', 'KM driven', 'number', 'details', { locked: true }),
  F('tyres', 'No. of tyres', 'tyres', 'details'),
  F('emission', 'Emission norm', 'select', 'details', { options: ['BS-VI', 'BS-IV', 'BS-III', 'Zero Emission'] }),
  F('fuel', 'Fuel type', 'select', 'details', { options: ['Diesel', 'CNG', 'Petrol', 'Electric'] }),
  F('transmission', 'Transmission', 'select', 'details', { options: ['Manual', 'Automatic', 'AMT'] }),
  F('regNo', 'Registration number', 'text', 'details'),
  F('engine', 'Engine', 'text', 'details'),
  F('power', 'Power', 'text', 'details'),
  F('load', 'Load capacity', 'text', 'details'),
  F('body', 'Body type', 'text', 'details'),
  F('photos', 'Photos', 'photos', 'media'),
  F('price', 'Expected price (₹)', 'number', 'pricing', { locked: true }),
  F('negotiable', 'Price is negotiable', 'toggle', 'pricing'),
  F('city', 'City', 'text', 'pricing', { locked: true }),
  F('state', 'State', 'state', 'pricing', { locked: true }),
  F('description', 'Description', 'textarea', 'pricing'),
  F('highlights', 'Highlights', 'checks', 'pricing', { options: HIGHLIGHTS }),
];
