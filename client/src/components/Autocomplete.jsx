import React, { useState, Fragment } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown } from 'lucide-react';

const Autocomplete = ({ items, selected, onChange, placeholder = "Select items...", multiple = true }) => {
    const [query, setQuery] = useState('');

    const filteredItems =
        query === ''
            ? (items || [])
            : (items || []).filter((item) => {
                // Use displayName if available, fallback to name
                const displayText = item?.displayName || item?.name || '';
                const q = query.toLowerCase().trim();
                return String(displayText).toLowerCase().includes(q);
            });

    const handleSelectAll = () => {
        if (selected.length === items.length) {
            onChange([]);
        } else {
            onChange(items.map(i => i.val));
        }
    };

    // Helper to check if an item is selected
    const isSelected = (val) => {
        if (multiple) {
            return selected.includes(val);
        }
        return selected === val;
    };

    // Helper to get display value
    const getDisplayValue = () => {
        if (multiple) {
            return selected.length > 0 ? `${selected.length} selected` : '';
        }
        const item = items.find(i => i.val === selected);
        // Use displayName if available, fallback to name
        return item ? (item.displayName || item.name) : '';
    };

    const handleChange = (val) => {
        setQuery('');
        onChange(val);
    };

    return (
        <div className="w-full relative">
            <Combobox value={selected} onChange={handleChange} multiple={multiple}>
                <div className="relative mt-1">
                    <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-slate-800 text-left shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-teal-300 sm:text-sm border border-slate-600">
                        <Combobox.Input
                            className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-white bg-slate-800 focus:ring-0"
                            displayValue={getDisplayValue}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={placeholder}
                            autoComplete="off"
                        />
                        <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <ChevronsUpDown
                                className="h-5 w-5 text-slate-400"
                                aria-hidden="true"
                            />
                        </Combobox.Button>
                    </div>
                    <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <Combobox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-slate-800 py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50 border border-slate-700">

                            {/* Select All Option - Only for multiple mode */}
                            {multiple && (
                                <div
                                    className="relative cursor-pointer select-none py-2 pl-10 pr-4 text-blue-400 hover:bg-slate-700 font-medium border-b border-slate-700"
                                    onClick={handleSelectAll}
                                >
                                    {selected.length === items.length ? 'Deselect All' : 'Select All'}
                                </div>
                            )}

                            {filteredItems.length === 0 && query !== '' ? (
                                <div className="relative cursor-default select-none py-2 px-4 text-slate-400">
                                    Nothing found.
                                </div>
                            ) : (
                                filteredItems.map((item, index) => (
                                    <Combobox.Option
                                        key={`${item.val}-${index}`}
                                        disabled={item.disabled}
                                        className={({ active, disabled }) =>
                                            `relative cursor-default select-none py-2 ${disabled
                                                ? 'bg-slate-900 text-slate-500 font-bold text-center italic border-y border-slate-700'
                                                : `pl-10 pr-4 ${active ? 'bg-blue-600 text-white' : 'text-slate-300'}`
                                            }`
                                        }
                                        value={item.val}
                                    >
                                        {({ selected: activeSelected, active, disabled }) => {
                                            if (disabled) {
                                                return <span>{item.name}</span>;
                                            }
                                            // Headless UI passes 'selected' based on internal logic, but we use our own helper for clarity
                                            const selectedState = isSelected(item.val);
                                            return (
                                                <>
                                                    <span
                                                        className={`block truncate ${selectedState ? 'font-medium' : 'font-normal'
                                                            }`}
                                                    >
                                                        {item.displayName || item.name}
                                                    </span>
                                                    {selectedState ? (
                                                        <span
                                                            className={`absolute inset-y-0 left-0 flex items-center pl-3 ${active ? 'text-white' : 'text-blue-400'
                                                                }`}
                                                        >
                                                            <Check className="h-5 w-5" aria-hidden="true" />
                                                        </span>
                                                    ) : null}
                                                </>
                                            )
                                        }}
                                    </Combobox.Option>
                                ))
                            )}
                        </Combobox.Options>
                    </Transition>
                </div>
            </Combobox>
        </div>
    );
};

export default Autocomplete;
