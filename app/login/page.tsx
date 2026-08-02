import dynamic from 'next/dynamic'

const Page = dynamic(() => import('@/components/pages/LoginPage'), { ssr: false })
export default Page
