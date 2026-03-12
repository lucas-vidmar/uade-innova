console.log('Diagnostic: BASE_URL check');
if (typeof import.meta !== 'undefined' && import.meta.env) {
    console.log('import.meta.env:', import.meta.env);
    console.log('VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL);
} else {
    console.log('import.meta.env is undefined');
}
