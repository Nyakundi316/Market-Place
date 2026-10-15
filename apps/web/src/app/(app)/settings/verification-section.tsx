'use client';

import {
  ID_DOCUMENT_TYPES,
  type VerificationKind,
  type VerificationRequestSummary,
} from '@markethub/shared';
import { BadgeCheck, Clock, FileImage, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  usePhoneCode,
  useRequestVerification,
  useVerification,
  useVerifyPhone,
} from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { ACCEPTED_IMAGES, uploadVerificationDocument } from '@/lib/images';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong';

const DOC_LABEL: Record<(typeof ID_DOCUMENT_TYPES)[number], string> = {
  national_id: 'National ID',
  passport: 'Passport',
  driving_licence: 'Driving licence',
};

function Row({
  title,
  done,
  children,
}: {
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        {done ? (
          <BadgeCheck className="size-5 text-primary" aria-hidden />
        ) : (
          <span
            className="size-5 rounded-full border-2 border-dashed border-muted-foreground/40"
            aria-hidden
          />
        )}
        <h3 className="text-sm font-medium">{title}</h3>
        {done && <span className="text-xs text-primary">Verified</span>}
      </div>
      <div className="mt-2 pl-7">{children}</div>
    </div>
  );
}

function PhoneRow({ number, verified }: { number: string | null; verified: boolean }) {
  const send = usePhoneCode();
  const verify = useVerifyPhone();
  const [phone, setPhone] = useState(number ?? '');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (verified && !sentTo) {
    return (
      <p className="text-sm text-muted-foreground">
        {number}{' '}
        <button
          type="button"
          className="ml-2 text-xs text-primary hover:underline"
          onClick={() => setSentTo('')}
        >
          Change
        </button>
      </p>
    );
  }
  return sentTo ? (
    <form
      className="grid gap-2 sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate(code, {
          onSuccess: () => {
            toast.success('Phone verified');
            setSentTo(null);
            setCode('');
          },
        });
      }}
    >
      <Label htmlFor="phone-code">Code sent to {sentTo}</Label>
      <div className="flex gap-2">
        <Input
          id="phone-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="tabular w-32 font-mono tracking-widest"
        />
        <Button type="submit" disabled={code.length !== 6 || verify.isPending}>
          {verify.isPending && <Loader2 className="size-4 animate-spin" />}
          Verify
        </Button>
      </div>
      {verify.isError && <p className="text-xs text-destructive">{errorText(verify.error)}</p>}
      <button
        type="button"
        className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setSentTo(null)}
      >
        Use a different number
      </button>
    </form>
  ) : (
    <form
      className="grid gap-2 sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate(phone, { onSuccess: () => setSentTo(phone) });
      }}
    >
      <Label htmlFor="phone-number">Mobile number</Label>
      <div className="flex gap-2">
        <Input
          id="phone-number"
          type="tel"
          autoComplete="tel"
          placeholder="+254 712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={phone.trim().length < 8 || send.isPending}
        >
          {send.isPending && <Loader2 className="size-4 animate-spin" />}
          Send code
        </Button>
      </div>
      {send.isError && <p className="text-xs text-destructive">{errorText(send.error)}</p>}
    </form>
  );
}

/** Status line for a document request, or the form to start one. */
function DocumentRow({
  kind,
  request,
}: {
  kind: VerificationKind;
  request: VerificationRequestSummary | null;
}) {
  const submit = useRequestVerification();
  const [docs, setDocs] = useState<{ key: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentType, setDocumentType] =
    useState<(typeof ID_DOCUMENT_TYPES)[number]>('national_id');
  const [businessName, setBusinessName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const file = useRef<HTMLInputElement>(null);

  if (request?.status === 'pending') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="size-4" aria-hidden /> Submitted — we usually review within a day.
      </p>
    );
  }

  const add = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, 4 - docs.length);
    if (file.current) file.current.value = '';
    setUploading(true);
    try {
      for (const f of picked) {
        const key = await uploadVerificationDocument(f);
        setDocs((d) => [...d, { key, name: f.name }]);
      }
    } catch {
      toast.error('Upload failed — try another photo');
    } finally {
      setUploading(false);
    }
  };

  const ready =
    docs.length > 0 &&
    !uploading &&
    (kind === 'id' || (businessName.trim().length >= 2 && registrationNumber.trim().length >= 3));

  return (
    <form
      className="grid gap-3 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const documents = docs.map((d) => d.key);
        submit.mutate(
          kind === 'id'
            ? { kind, documents, details: { documentType } }
            : {
                kind,
                documents,
                details: {
                  businessName: businessName.trim(),
                  registrationNumber: registrationNumber.trim(),
                },
              },
          {
            onSuccess: () => {
              toast.success('Sent for review');
              setDocs([]);
            },
          },
        );
      }}
    >
      {request?.status === 'rejected' && (
        <FormAlert>
          Last time: {request.note ?? 'we couldn’t verify it'}. You can try again.
        </FormAlert>
      )}
      {kind === 'id' ? (
        <div className="grid gap-1.5">
          <Label htmlFor="id-type">Document</Label>
          <NativeSelect
            id="id-type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as typeof documentType)}
          >
            {ID_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="biz-name">Registered name</Label>
            <Input
              id="biz-name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-reg">Registration no.</Label>
            <Input
              id="biz-reg"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </div>
        </div>
      )}

      <div>
        <input
          ref={file}
          type="file"
          accept={ACCEPTED_IMAGES}
          multiple
          hidden
          aria-label={kind === 'id' ? 'Choose ID photos' : 'Choose certificate photos'}
          onChange={(e) => void add(e.target.files)}
        />
        <ul className="mb-2 space-y-1">
          {docs.map((d) => (
            <li key={d.key} className="flex items-center gap-2 text-sm">
              <FileImage className="size-4 text-muted-foreground" aria-hidden />
              <span className="truncate">{d.name}</span>
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => setDocs((all) => all.filter((x) => x.key !== d.key))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || docs.length >= 4}
          onClick={() => file.current?.click()}
        >
          {uploading && <Loader2 className="size-4 animate-spin" />}
          {kind === 'id' ? 'Add photos (front and back)' : 'Add certificate photo'}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Stored privately and seen only by the team that reviews it.
        </p>
      </div>
      {submit.isError && <FormAlert>{errorText(submit.error)}</FormAlert>}
      <Button type="submit" disabled={!ready || submit.isPending} className="justify-self-start">
        {submit.isPending && <Loader2 className="size-4 animate-spin" />}
        Submit for review
      </Button>
    </form>
  );
}

/** §10 Phase 6 verification: email (done at sign-up), phone, ID, business. */
export function VerificationSection({ emailVerified }: { emailVerified: boolean }) {
  const q = useVerification();
  const v = q.data;
  return (
    <section id="verification" className="scroll-mt-20">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Verification
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Badges show buyers and sellers you&apos;re who you say you are.
      </p>
      {!v ? (
        <Skeleton className="mt-4 h-40" />
      ) : (
        <div className="mt-2">
          <Row title="Email" done={emailVerified}>
            <p
              className={cn(
                'text-sm',
                emailVerified ? 'text-muted-foreground' : 'text-destructive',
              )}
            >
              {emailVerified ? 'Confirmed' : 'Check your inbox for the confirmation link'}
            </p>
          </Row>
          <Row title="Phone" done={v.phone.verified}>
            {v.phone.available ? (
              <PhoneRow number={v.phone.number} verified={v.phone.verified} />
            ) : (
              <p className="text-sm text-muted-foreground">Coming soon.</p>
            )}
          </Row>
          <Row title="ID" done={v.id.verified}>
            {v.id.verified ? (
              <p className="text-sm text-muted-foreground">Your ID badge is live.</p>
            ) : (
              <DocumentRow kind="id" request={v.id.request} />
            )}
          </Row>
          <Row title="Business" done={v.business.verified}>
            {v.business.verified ? (
              <p className="text-sm text-muted-foreground">Your business badge is live.</p>
            ) : (
              <DocumentRow kind="business" request={v.business.request} />
            )}
          </Row>
        </div>
      )}
    </section>
  );
}
