import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CompanyProfile } from "@/types";

interface CompanyProfileState {
  profile: CompanyProfile | null;
}

const initialState: CompanyProfileState = { profile: null };

export const companyProfileSlice = createSlice({
  name: "companyProfile",
  initialState,
  reducers: {
    hydrateCompanyProfile(state, action: PayloadAction<CompanyProfile>) {
      state.profile = action.payload;
    },
  },
});

export const { hydrateCompanyProfile } = companyProfileSlice.actions;
