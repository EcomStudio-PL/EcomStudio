/** /auth/verified lives outside the (auth) route group (the /auth prefix is
 *  shared with the route handlers), but it is an account-entry page and must
 *  look like one — so it borrows the auth shell verbatim. */
export { default } from "@/app/(auth)/layout";
